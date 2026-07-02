export interface TokenPurchaseWidgetOptions {
  params?: any;
  clientSecret: string;
  intentId?: string;
  baseUrl?: string;
  walletConnect?: {
    projectId: string;
  };
  onReady?: () => void;
  onChange?: (event: { state: string; step: number }) => void;
  onSuccess?: (event: { intentId: string; txHash: string }) => void;
  onError?: (event: { code: string; message: string; retryable: boolean }) => void;
  onPriceChange?: (event: { oldPrice: number; newPrice: number; confirmed: boolean; canceled: boolean }) => void;
  appearance?: {
    theme?: string;
    variables?: Record<string, string>;
    rules?: Record<string, any>;
  };
}

export class TokenPurchaseWidget {
  constructor(options?: TokenPurchaseWidgetOptions);
  mount(selectorOrElement: string | HTMLElement): void;
  destroy(): void;
}

export interface PlatformClientOptions {
  baseUrl?: string;
  walletConnect?: {
    projectId: string;
  };
}

export class PlatformClient {
  constructor(publishableKey: string, options?: PlatformClientOptions);
  tokenPurchaseWidget(options?: TokenPurchaseWidgetOptions): TokenPurchaseWidget;
}

export function loadPlatformClient(
  publishableKey: string,
  options?: PlatformClientOptions
): Promise<PlatformClient>;
