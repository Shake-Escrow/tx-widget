# @shake-defi/react

React components for [`@shake-defi/js`](https://www.npmjs.com/package/@shake-defi/js) — a self-contained, embeddable widget for accepting ERC-20 stablecoin payments in exchange for tokens on EVM-compatible chains (Base mainnet / Base Sepolia). This package wraps the vanilla-JS SDK in a `<PlatformProvider>` + `<TokenPurchaseWidget>` pair so it drops cleanly into a React tree.

If you're not using React, use [`@shake-defi/js`](https://www.npmjs.com/package/@shake-defi/js) directly.

## Install

```bash
npm install @shake-defi/react @shake-defi/js
```

`react` and `react-dom` (>=18) are peer dependencies; `@shake-defi/js` is a direct dependency and doesn't need to be initialized separately.

## How it fits together

1. Your **backend** creates a `TokenPurchaseIntent` (server-side, using your secret key) and returns the `_widget_params` from that response to your frontend.
2. Your React app wraps its checkout UI in `<PlatformProvider publishableKey="pk_live_…">`.
3. `<TokenPurchaseWidget params={widgetParams} />` renders the actual payment UI and drives wallet connection, approval, and confirmation.
4. Your backend receives the final result via **webhook** — treat `onSuccess` as a UX signal, not a fulfillment trigger.

See the [`@shake-defi/js` README](https://www.npmjs.com/package/@shake-defi/js) for the backend (customer + intent creation) side of this flow, the full appearance/theming reference, and the error code table — this README covers the React-specific API only.

## Quickstart

```jsx
import { PlatformProvider, TokenPurchaseWidget } from '@shake-defi/react';

function App() {
  return (
    <PlatformProvider publishableKey={process.env.NEXT_PUBLIC_SHAKE_PUBLISHABLE_KEY}>
      <Checkout />
    </PlatformProvider>
  );
}

function Checkout() {
  // widgetParams and intentId come from your backend's
  // POST /token_purchase_intents response (intent._widget_params, intent.id)
  const { widgetParams, intentId } = useCheckoutIntent();

  return (
    <TokenPurchaseWidget
      params={widgetParams}
      intentId={intentId}
      appearance={{ theme: 'stripe' }}
      onSuccess={({ txHash }) => {
        // Optimistic UI update only — confirm fulfillment via webhook.
      }}
      onError={({ message }) => {
        console.error(message);
      }}
    />
  );
}
```

## API reference

### `<PlatformProvider>`

Initializes the SDK once at the root of your tree. Every `<TokenPurchaseWidget>` underneath shares this initialization.

```jsx
<PlatformProvider
  publishableKey={process.env.NEXT_PUBLIC_SHAKE_PUBLISHABLE_KEY}
  baseUrl={process.env.NEXT_PUBLIC_SHAKE_API_URL}
>
  {children}
</PlatformProvider>
```

| Prop | Type | Required | Description |
|---|---|---|---|
| `publishableKey` | `string` | Yes | Your `pk_live_…` / `pk_test_…` key. Safe to expose client-side. |
| `baseUrl` | `string` | No | Root URL of the Shake DeFi API (e.g. `https://api.shake-defi.com`), matching your key's mode. Only needed if a descendant widget uses the `clientSecret` init pattern — it's **not** your own backend's URL. |
| `options` | `object` | No | Passed through to the underlying `loadPlatformClient` call (e.g. `walletConnect`). |
| `children` | `ReactNode` | No | — |

A `<TokenPurchaseWidget>` rendered outside a `<PlatformProvider>` throws.

### `<TokenPurchaseWidget>`

Renders the payment widget into a `<div>` it manages internally.

```jsx
<TokenPurchaseWidget
  params={widgetParams}      // or clientSecret — not both
  intentId={intent.id}
  appearance={{ theme: 'night' }}
  className="my-widget"
  style={{ maxWidth: 420 }}
  onReady={() => {}}
  onChange={({ state, step }) => {}}
  onSuccess={({ intentId, txHash }) => {}}
  onError={({ code, message, retryable }) => {}}
  onPriceChange={({ oldPrice, newPrice, confirmed, canceled }) => {}}
/>
```

| Prop | Type | Description |
|---|---|---|
| `params` | `object` | The `_widget_params` object from your create-intent response. Use this **or** `clientSecret`. |
| `clientSecret` | `string` | The `client_secret` from your create-intent response. Requires `baseUrl` (Shake DeFi API root) on the parent `<PlatformProvider>`. |
| `intentId` | `string` | Echoed back in `onSuccess`. |
| `appearance` | `object` | `{ theme, variables, rules }` — see the `@shake-defi/js` README for the full theme/variable reference. |
| `onReady` | `() => void` | Widget has rendered and is interactive. |
| `onChange` | `({ state, step }) => void` | Fired on every internal state transition. |
| `onSuccess` | `({ intentId, txHash }) => void` | Purchase confirmed on-chain. |
| `onError` | `({ code, message, retryable }) => void` | Terminal or retryable error. Codes are documented in the `@shake-defi/js` README. |
| `onPriceChange` | `({ oldPrice, newPrice, confirmed, canceled }) => void` | Live price moved before confirmation; call `confirmed()` or `canceled()`. |
| `className` | `string` | Applied to the host `<div>`. |
| `style` | `React.CSSProperties` | Applied to the host `<div>`. |

The component remounts the underlying widget whenever `params` or `clientSecret` changes identity, and calls `.destroy()` automatically on unmount.

## Requirements

- React and ReactDOM >=18
- Node >=18 for build tooling

## License

Apache-2.0
