import * as React from 'react';
import { TokenPurchaseWidgetOptions, PlatformClient } from '@shake-defi/js';

export interface PlatformProviderProps {
  publishableKey: string;
  baseUrl?: string;
  options?: any;
  children?: React.ReactNode;
}

export function PlatformProvider(props: PlatformProviderProps): React.ReactElement;

export interface TokenPurchaseWidgetProps extends Omit<TokenPurchaseWidgetOptions, 'baseUrl' | 'walletConnect'> {
  className?: string;
  style?: React.CSSProperties;
}

export function TokenPurchaseWidget(props: TokenPurchaseWidgetProps): React.ReactElement;
