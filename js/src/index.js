'use strict';

import { TokenPurchaseWidget } from './widget.js';

// ── PlatformClient ────────────────────────────────────────────────────────────

export class PlatformClient {
  // publishableKey  — pk_live_… or pk_test_…
  // options.baseUrl — root URL of the backend API (required for clientSecret flow)
  constructor(publishableKey, options = {}) {
    if (!publishableKey) throw new Error('SDK: publishableKey is required.');
    if (!publishableKey.startsWith('pk_live_') && !publishableKey.startsWith('pk_test_')) {
      throw new Error('SDK: publishableKey must begin with pk_live_ or pk_test_.');
    }

    this._publishableKey = publishableKey;
    this._options        = options;
  }

  // Creates and returns a TokenPurchaseWidget instance.
  //
  // Initialise with params (direct) or clientSecret (recommended):
  //
  //   Direct — merchant passes _widget_params from their server to the frontend:
  //     tokenPurchaseWidget({ params: _widget_params })
  //
  //   clientSecret — widget fetches its own params on mount():
  //     tokenPurchaseWidget({ clientSecret: 'tpi_…_secret_…' })
  //     Requires baseUrl set on the SDK constructor or this call.
  //
  // The widget is not yet mounted; call widget.mount('#container') after creation.
  tokenPurchaseWidget(options = {}) {
    return new TokenPurchaseWidget({
      ...options,
      _publishableKey: this._publishableKey,
      _baseUrl:        options.baseUrl ?? this._options.baseUrl ?? null,
      walletConnect:   options.walletConnect ?? this._options.walletConnect,
    });
  }
}

// ── loadPlatformClient ────────────────────────────────────────────────────────

// Async loader — use this when loading the SDK dynamically or via npm.
//
//   const client = await loadPlatformClient('pk_live_…', { baseUrl: 'https://…' });
//
export async function loadPlatformClient(publishableKey, options = {}) {
  return new PlatformClient(publishableKey, options);
}

// Also expose as a synchronous global when loaded via <script> tag.
if (typeof window !== 'undefined') {
  const factory = (publishableKey, options) => new PlatformClient(publishableKey, options);
  factory.loadPlatformClient = loadPlatformClient;
  window.PlatformWidget = factory;
}

export { TokenPurchaseWidget };
