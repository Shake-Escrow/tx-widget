# @shake-defi/js

A self-contained, embeddable widget for accepting ERC-20 stablecoin payments in exchange for tokens on EVM-compatible chains. It handles the full purchase flow — multi-wallet discovery (EIP-6963), spend approval, and on-chain transaction submission — inside an encapsulated Shadow DOM component you can drop into any storefront.

Ships as ESM, CJS, and a standalone browser (`<script>`) bundle. `viem` is bundled in, so the widget has no runtime peer dependencies. A React wrapper is available separately as [`@shake-defi/react`](https://www.npmjs.com/package/@shake-defi/react).

## How it fits together

This SDK is the frontend half of a Payment-Intents–style flow:

1. Your **backend** creates a `TokenPurchaseIntent` using your secret key (`sk_live_…` / `sk_test_…`).
2. The create-intent response includes a `_widget_params` object — everything the widget needs to drive the on-chain confirmation. Your backend passes this to your frontend.
3. Your **frontend** initializes the widget with those params using your publishable key (`pk_live_…` / `pk_test_…`). The publishable key is safe to expose in client-side code; it can only initialize the widget, not create or read resources.
4. The customer connects a wallet, approves the payment currency, and confirms the purchase — all in-widget.
5. Your backend gets the final result via **webhook**, not the browser. The widget's `onSuccess` callback is a UX signal only; treat webhooks as the source of truth for fulfillment.

## Install

```bash
npm install @shake-defi/js
```

Or load it directly in a page with no build step:

```html
<script src="https://unpkg.com/@shake-defi/js/dist/platform.js"></script>
```

## Quickstart

### 1. Create a customer (once, server-side)

```js
const res = await fetch('https://api.shake-defi.com/v1/customers', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.SHAKE_SECRET_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ external_customer_id: user.id }),
});
const customer = await res.json(); // { id: "cus_…", … }
```

Calling this again with the same `external_customer_id` returns the existing customer instead of creating a duplicate, so it's safe to call on every checkout.

### 2. Create a purchase intent (server-side, per purchase)

```js
const res = await fetch('https://api.shake-defi.com/v1/token_purchase_intents', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.SHAKE_SECRET_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    customer: customer.id,
    amount: 5.00,              // human-readable, e.g. 5.00 = $5.00 equivalent
    payment_currency: 'USDC',  // one of the symbols in GET /account → currency_contracts
  }),
});
const intent = await res.json();
// intent._widget_params  — snapshot of everything the widget needs, frozen
//                           at creation time (including price_snapshot).
// intent.client_secret   — tpi_…_secret_… — send this instead of
//                           _widget_params if you want the widget to fetch
//                           its own (fresher) params. See "Two ways to
//                           initialize the widget" below.
```

### 3. Mount the widget (client-side)

There are two ways to hand the intent to the widget. Pick one.

**Option A — pass `params` directly.** Simplest option: no extra network call, no `baseUrl` needed. `price_snapshot` inside it is frozen at intent-creation time.

```js
import { loadPlatformClient } from '@shake-defi/js';

const client = await loadPlatformClient('pk_live_…');

const widget = client.tokenPurchaseWidget({
  params: widgetParams,   // intent._widget_params from step 2
  intentId: intent.id,
  appearance: { theme: 'stripe' },
  onSuccess: ({ intentId, txHash }) => {
    // Optimistic UI update only — confirm fulfillment via webhook.
  },
  onError: ({ code, message, retryable }) => {
    console.error(code, message);
  },
});

widget.mount('#purchase-widget');
```

**Option B — pass `clientSecret`.** The widget fetches its own params from the Shake DeFi API at mount time, including a live `current_price` — useful if you want accurate `onPriceChange` comparisons without round-tripping through your own backend. Requires `baseUrl` pointing at the Shake DeFi API (not your own server).

```js
const widget = client.tokenPurchaseWidget({
  clientSecret: intent.client_secret,    // from step 2
  baseUrl: 'https://api.shake-defi.com', // matches your key's mode (live/test)
  intentId: intent.id,
  onPriceChange: ({ oldPrice, newPrice, confirmed, canceled }) => {
    // show the customer the new price; call confirmed() or canceled()
  },
});

widget.mount('#purchase-widget');
```

`client_secret` is meant to be handed to the browser — that's the point of this flow — but treat it as a bearer credential scoped to that one intent: don't log it, and don't expose one customer's secret to another. Anyone holding it can read that intent's widget params via the public `GET /v1/widget/params` lookup.

### Script-tag usage

```html
<div id="purchase-widget"></div>
<script src="https://unpkg.com/@shake-defi/js/dist/platform.js"></script>
<script>
  const platform = PlatformWidget('pk_live_…');
  const widget = platform.tokenPurchaseWidget({ params: widgetParams });
  widget.mount('#purchase-widget');
</script>
```

### 4. Listen for the result (server-side webhook)

```js
app.post('/webhooks/shake-defi', express.json(), (req, res) => {
  const event = req.body;

  if (event.type === 'token_purchase_intent.succeeded') {
    // Credit event.data.object.token_amount (an 18-decimal wei BigInt-safe
    // integer) to the customer in event.data.object.customer.
  }

  res.sendStatus(200); // any 2xx acknowledges the event
});
```

Subscribed events: `token_purchase_intent.created`, `.succeeded`, `.failed`, `.canceled`. Return a non-2xx and the platform retries with exponential back-off (5s → 30s → 5m → 30m → 2h). Unconfirmed intents auto-cancel after 30 minutes.

## API reference

### `loadPlatformClient(publishableKey, options?)`

Async factory. Resolves to a `PlatformClient`.

```ts
loadPlatformClient(publishableKey: string, options?: PlatformClientOptions): Promise<PlatformClient>
```

| `options` | Type | Description |
|---|---|---|
| `baseUrl` | `string` | Root URL of the Shake DeFi API (e.g. `https://api.shake-defi.com`), matching your key's mode. Only required if you use the `clientSecret` init pattern below — it's **not** your own backend's URL. Can also be set per-widget via `tokenPurchaseWidget({ baseUrl })`. |
| `walletConnect.projectId` | `string` | WalletConnect project ID, used as a fallback when no injected wallet is detected. |

When loaded via `<script>`, the same factory is available synchronously as `window.PlatformWidget(publishableKey, options)`, plus `window.PlatformWidget.loadPlatformClient` for the async form.

### `client.tokenPurchaseWidget(options?)`

Returns a `TokenPurchaseWidget` instance. Not yet mounted — call `.mount()` next.

| Option | Type | Description |
|---|---|---|
| `params` | `object` | The `_widget_params` object from your create-intent response. Use this **or** `clientSecret`, not both. |
| `clientSecret` | `string` | The `client_secret` field from your create-intent response (`{intentId}_secret_…`). The widget fetches its own (live) params on mount. Requires `baseUrl` pointing at the Shake DeFi API. |
| `intentId` | `string` | The `tpi_…` ID, echoed back in `onSuccess`. |
| `appearance` | `object` | See [Appearance](#appearance) below. |
| `onReady` | `() => void` | Fired once the widget has rendered and is interactive. |
| `onChange` | `({ state, step }) => void` | Fired on every internal state transition. |
| `onSuccess` | `({ intentId, txHash }) => void` | Fired once the purchase confirms on-chain. |
| `onError` | `({ code, message, retryable }) => void` | Fired on any terminal or retryable error. See [Error codes](#error-codes). |
| `onPriceChange` | `({ oldPrice, newPrice, confirmed, canceled }) => void` | Fired if the live price moves beyond tolerance between intent creation and confirmation. Call `confirmed()` to proceed at the new price or `canceled()` to abort. If omitted, a price change fails the purchase automatically. |

### `widget.mount(selectorOrElement)`

Mounts the widget into the given CSS selector or `HTMLElement`. Returns the widget instance.

### `widget.destroy()`

Tears down the widget and removes all listeners. Call this on unmount to avoid leaks (e.g. lingering wallet event listeners).

### `widget.state`

Read-only getter for the widget's current lifecycle state: `loading → idle → [selecting_wallet] → connecting → approving → confirming → succeeded`, with `failed` and `expired` reachable from most non-terminal states.

## Appearance

```js
appearance: {
  theme: 'stripe',              // 'flat' (default) | 'stripe' | 'night'
  variables: {
    colorPrimary: '#635BFF',
    borderRadius: '12px',
  },
}
```

| Variable | Default |
|---|---|
| `colorPrimary` | `#635BFF` |
| `colorBackground` | `#FFFFFF` |
| `colorText` | `#1A1A2E` |
| `colorMuted` | `#6B7280` |
| `colorDanger` | `#EF4444` |
| `colorSuccess` | `#10B981` |
| `fontFamily` | `system-ui, -apple-system, sans-serif` |
| `borderRadius` | `8px` |
| `fontSize` | `14px` |

Variables are applied as CSS custom properties and pierce the widget's Shadow DOM, so they can also be set on the mount element's `style` instead of passed in JS if you prefer.

## Wallet support

The widget discovers every EIP-6963–announcing wallet installed in the browser (MetaMask, Coinbase Wallet, Rabby, etc.) rather than only whichever extension claimed `window.ethereum`. If more than one wallet is detected, the customer is shown a picker; with zero or one, the widget connects directly. Wallets that predate EIP-6963 are still picked up via the `window.ethereum` fallback.

If the connected wallet is on the wrong chain, the widget requests a switch (and adds the chain if the wallet doesn't have it yet) before continuing.

## Networks

Determined entirely by which key you use — there's no separate network parameter.

| Key prefix | Network |
|---|---|
| `pk_test_` / `sk_test_` | Base Sepolia (test stablecoins) |
| `pk_live_` / `sk_live_` | Base mainnet |

## Error codes

Passed to `onError` as `{ code, message, retryable }`:

| Code | Retryable | Meaning |
|---|---|---|
| `wallet_not_found` | No | No injected or discoverable wallet available. |
| `wallet_connection_rejected` | Yes | Customer rejected the connection request. |
| `wrong_chain` | Yes | Wallet is on the wrong network. |
| `chain_switch_rejected` | Yes | Customer rejected the network-switch request. |
| `insufficient_balance` | No | Wallet doesn't hold enough of the payment currency. |
| `approval_rejected` | Yes | Customer rejected the ERC-20 approval signature. |
| `approval_failed` | Yes | The approval transaction failed. |
| `confirmation_rejected` | Yes | Customer rejected the purchase signature. |
| `transaction_reverted` | No | The purchase transaction reverted on-chain. |
| `price_changed` | Yes | Live price moved beyond tolerance before confirmation. |
| `params_load_failed` | Yes | Failed to fetch widget params (`clientSecret` flow only). |
| `intent_expired` | No | The purchase window (30 minutes) elapsed. |
| `chain_congested` | Yes | RPC/mempool issues prevented submission. |

## Requirements

- Node >=18 for build tooling; the widget itself targets ES2020 / Chrome 80 / Firefox 78 / Safari 14 and later.

## License

Apache-2.0
