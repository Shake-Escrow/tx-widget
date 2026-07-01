'use strict';

import { WidgetUI } from './ui.js';
import { WidgetError, ERRORS } from './errors.js';
import { detectInjectedProvider, getDiscoveredProviders, connectWallet, ensureCorrectChain, onChainChanged, onAccountsChanged } from './wallet.js';
import { makePublicClient, makeWalletClient, getDecimals, approveIfNeeded, buyTokens } from './contracts.js';

// ── State machine ─────────────────────────────────────────────────────────────
//
//   [loading] → idle → [selecting_wallet] → connecting → approving → confirming → succeeded
//      ↓                                  ↘            ↘           ↘           ↘
//    failed                                 failed       failed      failed      failed / expired
//
// 'loading' is the initial state when the widget is initialised without
// direct `params`. It fetches _widget_params from the backend, then
// transitions to 'idle'. With direct params the widget starts in 'idle'
// immediately — clientSecret is still required either way, since buying
// needs a live voucher request after wallet connect.
//
// 'selecting_wallet' is only entered when more than one EIP-6963 wallet is
// detected on the page — with zero or one wallet available, idle/failed go
// straight to 'connecting'.
//
// 'expired' can be entered from any non-terminal state when the intent's
// expiry timestamp elapses or is detected as already past.

const VALID_TRANSITIONS = {
  loading:          ['idle', 'expired', 'failed'],
  idle:             ['selecting_wallet', 'connecting', 'expired'],
  selecting_wallet: ['connecting', 'failed', 'expired'],
  connecting:       ['approving', 'failed', 'expired'],
  approving:        ['confirming', 'failed', 'expired'],
  confirming:       ['succeeded', 'failed', 'expired'],
  succeeded:        [],
  failed:           ['loading', 'selecting_wallet', 'connecting'],
  expired:          [],
};

export class TokenPurchaseWidget {
  // options.clientSecret — tpi_…_secret_… from the create intent response.
  //                        Always required: buying requires a live voucher
  //                        request after wallet connect (see _fetchVoucher),
  //                        which this secret authorizes.
  // options.params       — optional _widget_params from the create intent
  //                        response. If provided, skips the initial params
  //                        fetch for a faster first paint; clientSecret is
  //                        still required for the voucher step later.
  // options.baseUrl      — root URL of the backend API, e.g. 'https://api.example.com'.
  //                        Always required.
  // options.intentId     — the tpi_… ID, used in onSuccess callback (optional)
  // options.onReady      — fired when the widget has rendered and is interactive
  // options.onChange     — fired on every state transition: ({ state, step })
  // options.onSuccess    — fired when purchase confirms: ({ intentId, txHash })
  // options.onError      — fired on terminal/retryable error: ({ code, message, retryable })
  // options.onPriceChange — fired if price moves between intent creation and confirm
  // options.appearance   — { theme, variables, rules }
  constructor(options = {}) {
    const { params } = options;

    // clientSecret + baseUrl are required unconditionally now, even when
    // `params` is also supplied for a fast first paint. Buying requires a
    // live POST /v1/widget/voucher call after wallet connect — XMAGSwap.buy()
    // signs the buyer's address into the voucher, so no static params object
    // can carry a usable one. The old "params only, zero backend calls"
    // mode no longer exists.
    if (!options.clientSecret) {
      throw new Error('TokenPurchaseWidget: clientSecret is required (even when params is also provided) — a live voucher request after wallet connect is required to buy.');
    }
    if (!options._baseUrl && !options.baseUrl) {
      throw new Error('TokenPurchaseWidget: baseUrl is required.');
    }

    if (params) {
      if (!params.contract_address)          throw new Error('params.contract_address is required.');
      if (!params.payment_currency_contract) throw new Error('params.payment_currency_contract is required.');
      if (!params.customer_ref)              throw new Error('params.customer_ref is required.');
      if (!params.amount)                    throw new Error('params.amount is required.');
      if (!params.payment_currency)          throw new Error('params.payment_currency is required.');
      if (!params.network)                   throw new Error('params.network is required.');
    }

    this._params       = params ?? null;
    this._clientSecret = options.clientSecret;
    this._baseUrl      = options._baseUrl ?? options.baseUrl;
    this._intentId     = options.intentId ?? null;
    this._appearance   = options.appearance ?? {};

    // Callbacks
    this._onReady       = options.onReady       ?? null;
    this._onChange      = options.onChange       ?? null;
    this._onSuccess     = options.onSuccess      ?? null;
    this._onError       = options.onError        ?? null;
    this._onPriceChange = options.onPriceChange  ?? null;

    // Internal state — 'loading' only if we still need to fetch initial
    // params; clientSecret is always present now, but direct `params` still
    // gets the fast path straight to 'idle'.
    this._state     = this._params ? 'idle' : 'loading';
    this._ui        = null;
    this._container = null;
    this._provider  = null;
    this._address   = null;
    this._cleanups  = [];  // functions to call on destroy()
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  mount(selectorOrElement) {
    const el = typeof selectorOrElement === 'string'
      ? document.querySelector(selectorOrElement)
      : selectorOrElement;

    if (!el) throw new Error(`TokenPurchaseWidget: container not found: ${selectorOrElement}`);

    this._container = el;
    this._ui = new WidgetUI(el, this._appearance);
    this._ui.setButtonHandler(() => this._handleButtonClick());
    this._ui.setWalletSelectHandler((uuid) => this._handleWalletSelect(uuid));

    if (!this._params) {
      // Params aren't available yet — show a loading spinner while we fetch them.
      // this._state is already 'loading' from the constructor; bypass _transition
      // since there's no prior state to validate against.
      this._ui.render('loading', null);
      this._loadParams();
    } else {
      this._ui.render('idle', this._params);
      this._scheduleExpiry();
      this._onReady?.();
    }

    return this;
  }

  destroy() {
    this._cleanups.forEach(fn => fn());
    this._cleanups = [];
    this._ui?.destroy();
    this._ui = null;
    this._container = null;
  }

  get state() {
    return this._state;
  }

  // ── State machine ───────────────────────────────────────────────────────────

  _transition(next, extra = {}) {
    const allowed = VALID_TRANSITIONS[this._state] ?? [];
    if (!allowed.includes(next)) {
      console.warn(`[Widget] Invalid transition: ${this._state} → ${next}`);
      return;
    }

    this._state = next;
    const step = { loading: null, idle: 0, selecting_wallet: 0, connecting: 0, approving: 1, confirming: 2, succeeded: 3 }[next] ?? null;

    this._ui?.render(next, this._params, extra);
    this._onChange?.({ state: next, step });
  }

  // ── Button handler ──────────────────────────────────────────────────────────

  _handleButtonClick() {
    if (this._state !== 'idle' && this._state !== 'failed') return;

    if (this._isExpired()) {
      this._transition('expired');
      return;
    }

    // If params haven't been loaded yet (clientSecret flow initial load failed),
    // retry the fetch rather than trying to connect a wallet.
    if (!this._params) {
      this._transition('loading');
      this._loadParams();
      return;
    }

    this._startConnection();
  }

  // Decides whether the user needs to pick a wallet first.
  _startConnection() {
    const discovered = getDiscoveredProviders();

    if (discovered.length > 1) {
      this._transition('selecting_wallet', {
        wallets: discovered.map(({ uuid, name, icon }) => ({ uuid, name, icon })),
      });
      return;
    }

    this._run(discovered[0]?.provider ?? detectInjectedProvider());
  }

  _handleWalletSelect(uuid) {
    const entry = getDiscoveredProviders().find((p) => p.uuid === uuid);
    this._run(entry?.provider ?? null);
  }

  // ── client_secret: fetch params from backend ────────────────────────────────

  // Fetches _widget_params from the backend using the clientSecret.
  // The endpoint is public — possession of the secret is the auth.
  async _fetchWidgetParams() {
    const url = `${this._baseUrl}/v1/widget/params?client_secret=${encodeURIComponent(this._clientSecret)}`;
    const res = await fetch(url);

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (res.status === 410) {
        throw new WidgetError(ERRORS.INTENT_EXPIRED, 'This purchase link has expired.');
      }
      throw new WidgetError(
        ERRORS.PARAMS_LOAD_FAILED,
        body.error?.message ?? `Failed to load widget parameters (${res.status}).`,
      );
    }

    const json = await res.json();
    return json._widget_params ?? json;
  }

  // Called on initial mount (clientSecret flow) and on retry after a load failure.
  async _loadParams() {
    try {
      const params = await this._fetchWidgetParams();

      // Guard: widget may have been destroyed while fetch was in flight.
      if (!this._ui) return;

      this._params = params;

      if (this._isExpired()) {
        this._transition('expired');
        return;
      }

      this._transition('idle');
      this._scheduleExpiry();
      this._onReady?.();
    } catch (err) {
      if (!this._ui) return;
      this._handleError(err);
    }
  }

  // ── Intent expiry ───────────────────────────────────────────────────────────

  // Returns true if the intent's expiry timestamp has already elapsed.
  _isExpired() {
    return !!(this._params?.expires_at && Date.now() >= this._params.expires_at * 1000);
  }

  // Schedules a transition to 'expired' for intents that carry an expires_at
  // timestamp. Only fires while the widget is idle or waiting for wallet
  // selection — during active transaction states the contract will revert
  // on-chain, surfacing a TRANSACTION_REVERTED error naturally.
  _scheduleExpiry() {
    if (!this._params?.expires_at) return;

    const msUntilExpiry = (this._params.expires_at * 1000) - Date.now();
    if (msUntilExpiry <= 0) {
      this._transition('expired');
      return;
    }

    const timer = setTimeout(() => {
      if (['idle', 'loading', 'selecting_wallet'].includes(this._state)) {
        this._transition('expired');
      }
    }, msUntilExpiry);

    this._cleanups.push(() => clearTimeout(timer));
  }

  // ── Main flow ───────────────────────────────────────────────────────────────

  async _run(provider) {
    this._transition('connecting');

    try {
      // Step 1 — Connect wallet
      this._provider = provider;
      this._address  = await connectWallet(this._provider);

      // Listen for account/chain changes while mounted and abort if they occur
      this._cleanups.push(onAccountsChanged(this._provider, () => this._handleExternalChange()));
      this._cleanups.push(onChainChanged(this._provider,   () => this._handleExternalChange()));

      await ensureCorrectChain(this._provider, this._params.network);

      // Build viem clients
      const publicClient = makePublicClient(this._params.network);
      const walletClient = makeWalletClient(this._params.network, this._provider);

      const decimals = await getDecimals(publicClient, this._params.payment_currency_contract, this._params.payment_currency);

      // Step 2 — Approve
      this._transition('approving');
      await approveIfNeeded(
        publicClient,
        walletClient,
        this._params.payment_currency_contract,
        this._params.contract_address,
        this._params.amount,
        decimals,
        this._address,
      );

      // Step 3 — Get a buyer-bound voucher, then buy.
      // approve() above is price-independent (it only authorizes spending
      // this._params.amount of the payment currency), so it's safe to have
      // done it before the voucher exists. The voucher is fetched fresh
      // right here, immediately before the signature prompt, to keep its
      // deadline window as tight as possible.
      this._transition('confirming');

      const voucher = await this._fetchVoucher();

      if (this._priceMoved(voucher)) {
        await this._confirmPriceChange(voucher);
      }

      const txHash = await buyTokens(
        publicClient,
        walletClient,
        this._params.contract_address,
        this._params.customer_ref,
        voucher.payment_token,
        BigInt(voucher.payment_amount),
        BigInt(voucher.rate),
        BigInt(voucher.deadline),
        voucher.signature,
        this._address,
      );

      // Succeeded
      this._transition('succeeded', { txHash });
      this._onSuccess?.({ intentId: this._intentId, txHash });

    } catch (err) {
      this._handleError(err);
    }
  }

  // ── Voucher fetch (post wallet-connect, pre buy()) ──────────────────────────

  // Fetches a purchase voucher bound to this._address. Must happen after
  // wallet connect — see routes/widgetVoucher.js for why the backend can't
  // sign one any earlier.
  async _fetchVoucher() {
    const res = await fetch(`${this._baseUrl}/v1/widget/voucher`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_secret: this._clientSecret, buyer: this._address }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (res.status === 410) {
        throw new WidgetError(ERRORS.INTENT_EXPIRED, 'This purchase link has expired.');
      }
      throw new WidgetError(
        ERRORS.VOUCHER_LOAD_FAILED,
        body.error?.message ?? `Failed to load purchase voucher (${res.status}).`,
      );
    }

    return res.json();
  }

  // ── Price change interception ───────────────────────────────────────────────

  _priceMoved(voucher) {
    return (
      voucher.price_snapshot != null &&
      voucher.current_price != null &&
      voucher.price_snapshot !== voucher.current_price
    );
  }

  // Pauses before the buy() signature prompt and surfaces the price move to
  // the merchant. The merchant's onPriceChange handler calls confirmed() to
  // proceed with the voucher already in hand, or canceled() to abort.
  async _confirmPriceChange(voucher) {
    if (!this._onPriceChange) {
      throw new WidgetError(ERRORS.PRICE_CHANGED, 'Token price changed before confirmation.');
    }

    await new Promise((resolve, reject) => {
      this._onPriceChange({
        oldPrice:  voucher.price_snapshot,
        newPrice:  voucher.current_price,
        confirmed: resolve,
        canceled:  () => reject(new WidgetError(ERRORS.PRICE_CHANGED, 'Price change not accepted.')),
      });
    });
  }

  // ── Error handling ──────────────────────────────────────────────────────────

  _handleError(err) {
    const widgetErr = err instanceof WidgetError
      ? err
      : new WidgetError(ERRORS.TRANSACTION_REVERTED, err.message ?? 'An unexpected error occurred.', err);

    if (widgetErr.code === 'intent_expired') {
      this._transition('expired');
    } else {
      this._transition('failed', { error: widgetErr });
    }

    this._onError?.({
      code:      widgetErr.code,
      message:   widgetErr.message,
      retryable: widgetErr.retryable,
    });
  }

  // If the user switches account or chain while the widget is mounted, reset
  // to idle so they can start the flow fresh with the new context.
  _handleExternalChange() {
    if (['succeeded', 'expired'].includes(this._state)) return;
    this._state = 'idle';
    this._address = null;
    this._ui?.render('idle', this._params);
    this._onChange?.({ state: 'idle', step: 0 });
  }
}
