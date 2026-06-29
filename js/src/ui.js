'use strict';

// All DOM rendering lives here. The widget mounts into a Shadow DOM so its
// styles are fully encapsulated and don't bleed into the merchant's page.
// Merchant customization flows in via CSS custom properties on the host element,
// which pierce the shadow boundary.

const DEFAULT_VARS = {
  colorPrimary:    '#635BFF',
  colorBackground: '#FFFFFF',
  colorText:       '#1A1A2E',
  colorMuted:      '#6B7280',
  colorDanger:     '#EF4444',
  colorSuccess:    '#10B981',
  fontFamily:      'system-ui, -apple-system, sans-serif',
  borderRadius:    '8px',
  fontSize:        '14px',
};

// Builds the CSS custom properties block from appearance.variables, falling
// back to defaults for any unset values.
function buildCssVars(variables = {}) {
  const merged = { ...DEFAULT_VARS, ...variables };
  return Object.entries(merged)
    .map(([k, v]) => `--p-${camelToKebab(k)}: ${v};`)
    .join('\n    ');
}

function camelToKebab(str) {
  return str.replace(/([A-Z])/g, '-$1').toLowerCase();
}

// ── Base stylesheet ───────────────────────────────────────────────────────────

function buildStylesheet(appearance = {}) {
  const vars = buildCssVars(appearance.variables);
  const theme = appearance.theme ?? 'flat';

  return `
    :host {
      ${vars}
      display: block;
      font-family: var(--p-font-family);
      font-size: var(--p-font-size);
      color: var(--p-color-text);
    }

    .Widget {
      background: var(--p-color-background);
      border-radius: var(--p-border-radius);
      padding: 24px;
      ${theme === 'flat' ? 'border: 1px solid #E5E7EB;' : ''}
      ${theme === 'stripe' ? 'box-shadow: 0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.08);' : ''}
      ${theme === 'night' ? 'background: #1F2937; color: #F9FAFB; border: 1px solid #374151;' : ''}
    }

    .Steps {
      display: flex;
      gap: 8px;
      margin-bottom: 20px;
    }

    .Step {
      flex: 1;
      height: 4px;
      border-radius: 2px;
      background: #E5E7EB;
      transition: background 0.3s ease;
    }

    .Step--active   { background: var(--p-color-primary); }
    .Step--complete { background: var(--p-color-success);  }

    .Status {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      padding: 12px 0;
      text-align: center;
    }

    .Icon {
      width: 48px;
      height: 48px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
    }

    .Icon--spinning { background: #F3F4F6; }
    .Icon--success  { background: #D1FAE5; }
    .Icon--error    { background: #FEE2E2; }

    .Spinner {
      width: 24px;
      height: 24px;
      border: 3px solid #E5E7EB;
      border-top-color: var(--p-color-primary);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin { to { transform: rotate(360deg); } }

    .Label {
      font-weight: 600;
      font-size: 16px;
    }

    .Sublabel {
      color: var(--p-color-muted);
      font-size: 13px;
      max-width: 280px;
    }

    .TxLink {
      font-size: 12px;
      color: var(--p-color-primary);
      text-decoration: none;
      word-break: break-all;
    }
    .TxLink:hover { text-decoration: underline; }

    .Button {
      margin-top: 16px;
      width: 100%;
      padding: 12px;
      border: none;
      border-radius: var(--p-border-radius);
      background: var(--p-color-primary);
      color: #FFFFFF;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.15s ease;
    }
    .Button:hover   { opacity: 0.9; }
    .Button:active  { opacity: 0.8; }
    .Button:disabled { opacity: 0.5; cursor: not-allowed; }

    .WalletList {
      display: flex;
      flex-direction: column;
      gap: 8px;
      width: 100%;
      margin-top: 8px;
    }

    .WalletOption {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 10px 14px;
      border: 1px solid #E5E7EB;
      border-radius: var(--p-border-radius);
      background: var(--p-color-background);
      color: var(--p-color-text);
      font-size: 14px;
      font-weight: 500;
      font-family: inherit;
      cursor: pointer;
      transition: border-color 0.15s ease, background 0.15s ease;
    }
    .WalletOption:hover  { border-color: var(--p-color-primary); }
    .WalletOption:active { opacity: 0.85; }

    .WalletIcon {
      width: 24px;
      height: 24px;
      border-radius: 6px;
      flex-shrink: 0;
    }

    .WalletName {
      flex: 1;
      text-align: left;
    }

    .ErrorMsg {
      margin-top: 12px;
      padding: 10px 12px;
      background: #FEF2F2;
      border: 1px solid #FECACA;
      border-radius: var(--p-border-radius);
      color: var(--p-color-danger);
      font-size: 13px;
    }
  `;
}

// ── SVG icons ─────────────────────────────────────────────────────────────────

// Wallet name/icon strings come from EIP-6963 info objects, which are
// controlled by whatever extensions the user has installed — not by us or by
// the merchant. Escape before interpolating into innerHTML.
function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const ICON_CHECK = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M5 13l4 4L19 7" stroke="#10B981" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

const ICON_X = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M18 6L6 18M6 6l12 12" stroke="#EF4444" stroke-width="2.5" stroke-linecap="round"/>
</svg>`;

// ── Renderer ──────────────────────────────────────────────────────────────────

const STEP_LABELS = ['Connect wallet', 'Approve', 'Purchase'];

const STATE_CONTENT = {
  idle: (params) => ({
    step: 0,
    icon: null,
    label: `Purchase ${params.payment_currency}`,
    sublabel: `Pay ${params.amount} ${params.payment_currency} to receive tokens.`,
    button: { label: 'Connect Wallet', disabled: false },
  }),

  // Shown only when more than one EIP-6963 wallet was detected on the page —
  // with zero or one wallet the widget skips straight to 'connecting'.
  selecting_wallet: (_params, extra) => ({
    step: 0,
    icon: null,
    label: 'Choose a wallet',
    sublabel: 'Select which wallet you want to connect.',
    wallets: extra?.wallets ?? [],
    button: null,
  }),

  connecting: () => ({
    step: 0,
    icon: 'spinner',
    label: 'Connecting wallet…',
    sublabel: 'Approve the connection request in your wallet.',
    button: null,
  }),

  approving: (params) => ({
    step: 1,
    icon: 'spinner',
    label: `Approving ${params.payment_currency}…`,
    sublabel: `Sign the approval in your wallet to allow the swap contract to spend your ${params.payment_currency}.`,
    button: null,
  }),

  confirming: () => ({
    step: 2,
    icon: 'spinner',
    label: 'Confirming purchase…',
    sublabel: 'Sign the purchase transaction in your wallet and wait for it to confirm on-chain.',
    button: null,
  }),

  succeeded: (params, extra) => ({
    step: 3,
    icon: 'success',
    label: 'Purchase complete',
    sublabel: 'Your tokens are on the way. Check back in a moment.',
    txHash: extra?.txHash,
    network: params?.network,
    button: null,
  }),

  failed: (_params, extra) => ({
    step: null,
    icon: 'error',
    label: 'Something went wrong',
    sublabel: extra?.error?.message ?? 'An unexpected error occurred.',
    button: extra?.error?.retryable ? { label: 'Try again', disabled: false } : null,
  }),

  expired: () => ({
    step: null,
    icon: 'error',
    label: 'Purchase link expired',
    sublabel: 'This purchase window has expired. Please start over.',
    button: null,
  }),
};

function explorerUrl(txHash, network) {
  const base = network === 'base-mainnet'
    ? 'https://basescan.org/tx/'
    : 'https://sepolia.basescan.org/tx/';
  return base + txHash;
}

export class WidgetUI {
  constructor(container, appearance) {
    this._container = container;
    this._appearance = appearance ?? {};
    this._onButtonClick = null;
    this._onWalletSelect = null;

    // Attach shadow root
    this._shadow = container.attachShadow({ mode: 'open' });

    // Inject stylesheet
    const style = document.createElement('style');
    style.textContent = buildStylesheet(this._appearance);
    this._shadow.appendChild(style);

    // Create root widget div
    this._root = document.createElement('div');
    this._root.className = 'Widget';
    this._shadow.appendChild(this._root);
  }

  // Renders the widget for a given state.
  // params: _widget_params from the intent response
  // extra: { txHash?, error?, wallets? }
  render(state, params, extra = {}) {
    const contentFn = STATE_CONTENT[state];
    if (!contentFn) return;

    const content = contentFn(params, extra);

    this._root.innerHTML = `
      ${this._renderSteps(content.step)}
      <div class="Status">
        ${content.icon ? this._renderIcon(content.icon) : ''}
        <div class="Label">${content.label}</div>
        <div class="Sublabel">${content.sublabel}</div>
        ${content.wallets?.length ? this._renderWalletList(content.wallets) : ''}
        ${content.txHash ? `
          <a class="TxLink" href="${explorerUrl(content.txHash, content.network)}" target="_blank" rel="noopener">
            View on explorer ↗
          </a>` : ''}
        ${content.button ? `
          <button class="Button" ${content.button.disabled ? 'disabled' : ''}>
            ${content.button.label}
          </button>` : ''}
        ${extra.error && !extra.error.retryable ? `
          <div class="ErrorMsg">${extra.error.message}</div>` : ''}
      </div>
    `;

    // Re-attach button handler after innerHTML reset
    const btn = this._root.querySelector('.Button');
    if (btn && this._onButtonClick) {
      btn.addEventListener('click', this._onButtonClick);
    }

    // Re-attach wallet-selection handlers after innerHTML reset
    if (content.wallets?.length && this._onWalletSelect) {
      this._root.querySelectorAll('.WalletOption').forEach((el) => {
        el.addEventListener('click', () => this._onWalletSelect(el.dataset.uuid));
      });
    }
  }

  setButtonHandler(fn) {
    this._onButtonClick = fn;
  }

  // fn receives the uuid of the EIP-6963 wallet entry the user picked.
  setWalletSelectHandler(fn) {
    this._onWalletSelect = fn;
  }

  _renderWalletList(wallets) {
    return `
      <div class="WalletList">
        ${wallets.map((w) => `
          <button class="WalletOption" data-uuid="${escapeHtml(w.uuid)}" type="button">
            ${w.icon ? `<img class="WalletIcon" src="${escapeHtml(w.icon)}" alt="" />` : ''}
            <span class="WalletName">${escapeHtml(w.name ?? 'Unknown wallet')}</span>
          </button>
        `).join('')}
      </div>
    `;
  }

  _renderSteps(activeStep) {
    const steps = STEP_LABELS.map((_, i) => {
      let cls = 'Step';
      if (activeStep === null) cls += '';
      else if (i < activeStep)  cls += ' Step--complete';
      else if (i === activeStep) cls += ' Step--active';
      return `<div class="${cls}" title="${STEP_LABELS[i]}"></div>`;
    });
    return `<div class="Steps">${steps.join('')}</div>`;
  }

  _renderIcon(type) {
    if (type === 'spinner') {
      return `<div class="Icon Icon--spinning"><div class="Spinner"></div></div>`;
    }
    if (type === 'success') {
      return `<div class="Icon Icon--success">${ICON_CHECK}</div>`;
    }
    if (type === 'error') {
      return `<div class="Icon Icon--error">${ICON_X}</div>`;
    }
    return '';
  }

  destroy() {
    this._shadow.innerHTML = '';
  }
}
