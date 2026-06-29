'use strict';

import { TokenPurchaseWidget } from './widget.js';

// ── Xmagnet ───────────────────────────────────────────────────────────────────

export class Xmagnet {
  // publishableKey  — pk_live_… or pk_test_…
  // options.walletConnect.projectId — WalletConnect v2 project ID (optional)
  constructor(publishableKey, options = {}) {
    if (!publishableKey) throw new Error('Xmagnet: publishableKey is required.');
    if (!publishableKey.startsWith('pk_live_') && !publishableKey.startsWith('pk_test_')) {
      throw new Error('Xmagnet: publishableKey must begin with pk_live_ or pk_test_.');
    }

    this._publishableKey = publishableKey;
    this._options        = options;
  }

  // Creates and returns a TokenPurchaseWidget instance.
  //
  // Required option:
  //   options.params — the _widget_params object from the POST /v1/token_purchase_intents response
  //
  // The widget is not yet mounted; call widget.mount('#container') after creation.
  //
  // NOTE: This API uses _widget_params from the create intent response rather
  // than a client_secret (as described in frontend-widget.md). Adding
  // client_secret support requires a backend endpoint that the widget can call
  // to fetch its params — a straightforward addition when needed.
  tokenPurchaseWidget(options = {}) {
    return new TokenPurchaseWidget({
      ...options,
      _publishableKey: this._publishableKey,
      walletConnect:   options.walletConnect ?? this._options.walletConnect,
    });
  }
}

// ── loadXmagnet ───────────────────────────────────────────────────────────────

// Async loader — use this when loading the SDK dynamically or via npm.
//
//   const xmagnet = await loadXmagnet('pk_live_…');
//
export async function loadXmagnet(publishableKey, options = {}) {
  return new Xmagnet(publishableKey, options);
}

// Also expose as a synchronous global when loaded via <script> tag.
// The script sets window.Xmagnet so merchants can do:
//   const xmagnet = Xmagnet('pk_live_…');
if (typeof window !== 'undefined') {
  // Allow Xmagnet('pk_…') as well as new Xmagnet('pk_…')
  const XmagnetFactory = (publishableKey, options) => new Xmagnet(publishableKey, options);
  XmagnetFactory.loadXmagnet = loadXmagnet;
  window.Xmagnet = XmagnetFactory;
}

export { TokenPurchaseWidget };
