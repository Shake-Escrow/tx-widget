'use strict';

import { WidgetUI } from './ui.js';
import { WidgetError, ERRORS } from './errors.js';
import { detectInjectedProvider, getDiscoveredProviders, connectWallet, ensureCorrectChain, onChainChanged, onAccountsChanged } from './wallet.js';
import { makePublicClient, makeWalletClient, getDecimals, approveIfNeeded, buyTokens } from './contracts.js';

// ── State machine ─────────────────────────────────────────────────────────────
//
//   idle → [selecting_wallet] → connecting → approving → confirming → succeeded
//                             ↘                        ↘            ↘ failed
//                               failed                   failed       expired
//
// 'selecting_wallet' is only entered when more than one EIP-6963 wallet is
// detected on the page — with zero or one wallet available, idle/failed go
// straight to 'connecting'.
//
// Any state can also transition to 'expired' if the intent's 30-minute
// window elapses (detected via the expiry timestamp in _widget_params).

const VALID_TRANSITIONS = {
  idle:             ['selecting_wallet', 'connecting'],
  selecting_wallet: ['connecting', 'failed'],
  connecting:       ['approving', 'failed'],
  approving:        ['confirming', 'failed'],
  confirming:       ['succeeded', 'failed', 'expired'],
  succeeded:        [],
  failed:           ['selecting_wallet', 'connecting'],  // retry resets to connecting
  expired:          [],
};

export class TokenPurchaseWidget {
  // options.params      — _widget_params from the create intent response (required)
  // options.intentId    — the tpi_… ID, used in onSuccess callback (optional)
  // options.onReady     — fired when the widget has rendered and is interactive
  // options.onChange    — fired on every state transition: ({ state, step })
  // options.onSuccess   — fired when purchase confirms: ({ intentId, txHash })
  // options.onError     — fired on terminal/retryable error: ({ code, message, retryable })
  // options.onPriceChange — fired if price moves between intent creation and confirm
  // options.appearance  — { theme, variables, rules }
  // options.walletConnect — { projectId } (WalletConnect v2 — not yet implemented)
  constructor(options = {}) {
    const { params } = options;
    if (!params) throw new Error('TokenPurchaseWidget: options.params is required.');
    if (!params.contract_address)          throw new Error('params.contract_address is required.');
    if (!params.payment_currency_contract) throw new Error('params.payment_currency_contract is required.');
    if (!params.customer_ref)              throw new Error('params.customer_ref is required.');
    if (!params.amount)                    throw new Error('params.amount is required.');
    if (!params.payment_currency)          throw new Error('params.payment_currency is required.');
    if (!params.network)                   throw new Error('params.network is required.');

    this._params     = params;
    this._intentId   = options.intentId ?? null;
    this._appearance = options.appearance ?? {};

    // Callbacks
    this._onReady       = options.onReady       ?? null;
    this._onChange      = options.onChange       ?? null;
    this._onSuccess     = options.onSuccess      ?? null;
    this._onError       = options.onError        ?? null;
    this._onPriceChange = options.onPriceChange  ?? null;

    // Internal state
    this._state     = 'idle';
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
    this._ui.render('idle', this._params);

    this._onReady?.();
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
    const step = { idle: 0, selecting_wallet: 0, connecting: 0, approving: 1, confirming: 2, succeeded: 3 }[next] ?? null;

    this._ui?.render(next, this._params, extra);
    this._onChange?.({ state: next, step });
  }

  // ── Button handler ──────────────────────────────────────────────────────────

  _handleButtonClick() {
    if (this._state === 'idle' || this._state === 'failed') {
      this._startConnection();
    }
  }

  // Decides whether the user needs to pick a wallet first. With zero wallets
  // detected we fall through to the legacy window.ethereum path (and let
  // connectWallet surface WALLET_NOT_FOUND if that's empty too); with exactly
  // one we connect directly — no point making the user click twice to confirm
  // the only option; with more than one we ask.
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

  // Called by the UI when the user picks a wallet from the multi-wallet list.
  _handleWalletSelect(uuid) {
    const entry = getDiscoveredProviders().find((p) => p.uuid === uuid);
    this._run(entry?.provider ?? null);
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

      // Step 3 — Buy
      this._transition('confirming');
      let txHash;
      try {
        txHash = await buyTokens(
          publicClient,
          walletClient,
          this._params.contract_address,
          this._params.customer_ref,
          this._address,
        );
      } catch (err) {
        if (err instanceof WidgetError && err.code === 'price_changed') {
          await this._handlePriceChange(publicClient, walletClient, decimals);
          return;
        }
        throw err;
      }

      // Succeeded
      this._transition('succeeded', { txHash });
      this._onSuccess?.({ intentId: this._intentId, txHash });

    } catch (err) {
      this._handleError(err);
    }
  }

  // ── Price change interception ───────────────────────────────────────────────

  async _handlePriceChange(publicClient, walletClient, decimals) {
    if (!this._onPriceChange) {
      // No handler supplied — fail immediately
      this._handleError(new WidgetError(ERRORS.PRICE_CHANGED, 'Token price changed before confirmation.'));
      return;
    }

    // Pause at confirming state and surface the price change to the merchant.
    // The merchant's onPriceChange handler calls confirmed() to resume.
    await new Promise((resolve, reject) => {
      this._onPriceChange({
        // In a full implementation, fetch the current price from GET /v1/account
        // For now, signal that price has changed without the new value
        oldPrice: this._params.price_snapshot ?? null,
        newPrice: null,  // would come from a fresh GET /v1/account call
        confirmed: resolve,
        canceled:  () => reject(new WidgetError(ERRORS.PRICE_CHANGED, 'Price change not accepted.')),
      });
    });

    // Retry the buy at the new price
    try {
      const txHash = await buyTokens(
        publicClient,
        walletClient,
        this._params.contract_address,
        this._params.customer_ref,
        this._address,
      );
      this._transition('succeeded', { txHash });
      this._onSuccess?.({ intentId: this._intentId, txHash });
    } catch (err) {
      this._handleError(err);
    }
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
