'use strict';

// Every error surfaced to onError has a stable code, a human-readable message,
// and a retryable flag. Retryable errors leave the widget in a recoverable
// state; non-retryable errors should prompt the merchant UI to offer a
// "start over" path (new intent + fresh widget mount).

export const ERRORS = {
  // Wallet
  WALLET_NOT_FOUND:           { code: 'wallet_not_found',           retryable: false },
  WALLET_CONNECTION_REJECTED: { code: 'wallet_connection_rejected',  retryable: true  },
  WRONG_CHAIN:                { code: 'wrong_chain',                 retryable: true  },
  CHAIN_SWITCH_REJECTED:      { code: 'chain_switch_rejected',       retryable: true  },

  // Transactions
  INSUFFICIENT_BALANCE:       { code: 'insufficient_balance',        retryable: false },
  APPROVAL_REJECTED:          { code: 'approval_rejected',           retryable: true  },
  APPROVAL_FAILED:            { code: 'approval_failed',             retryable: true  },
  CONFIRMATION_REJECTED:      { code: 'confirmation_rejected',       retryable: true  },
  TRANSACTION_REVERTED:       { code: 'transaction_reverted',        retryable: false },
  PRICE_CHANGED:              { code: 'price_changed',               retryable: true  },
  VOUCHER_EXPIRED:            { code: 'voucher_expired',             retryable: true  },
  ALREADY_PURCHASED:          { code: 'already_purchased',           retryable: false },
  INVALID_SIGNATURE:          { code: 'invalid_signature',           retryable: false },
  PAYMENT_TOKEN_NOT_ACCEPTED: { code: 'payment_token_not_accepted',  retryable: false },

  // Intent lifecycle
  PARAMS_LOAD_FAILED:         { code: 'params_load_failed',          retryable: true  },
  VOUCHER_LOAD_FAILED:        { code: 'voucher_load_failed',         retryable: true  },
  INTENT_EXPIRED:             { code: 'intent_expired',              retryable: false },
  CHAIN_CONGESTED:            { code: 'chain_congested',             retryable: true  },
};

export class WidgetError extends Error {
  constructor(type, message, cause) {
    super(message);
    this.name    = 'WidgetError';
    this.code    = type.code;
    this.retryable = type.retryable;
    if (cause) this.cause = cause;
  }
}
