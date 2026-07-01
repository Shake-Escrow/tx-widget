import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { loadPlatformClient } from '@shake-defi/js';

// ── Context ───────────────────────────────────────────────────────────────────

const PlatformContext = createContext(null);

// Initialises the SDK once at the tree root. All TokenPurchaseWidget instances
// in the tree share this initialisation.
//
//   <PlatformProvider
//     publishableKey={process.env.NEXT_PUBLIC_PLATFORM_KEY}
//     baseUrl={process.env.NEXT_PUBLIC_API_URL}
//   >
//     ...
//   </PlatformProvider>
export function PlatformProvider({ publishableKey, baseUrl, options = {}, children }) {
  const [client, setClient] = useState(null);

  useEffect(() => {
    if (!publishableKey) return;
    loadPlatformClient(publishableKey, { ...options, baseUrl }).then(setClient);
  }, [publishableKey, baseUrl]);

  return (
    <PlatformContext.Provider value={client}>
      {children}
    </PlatformContext.Provider>
  );
}

function usePlatformClient() {
  const client = useContext(PlatformContext);
  if (!client) throw new Error('TokenPurchaseWidget must be used inside <PlatformProvider>.');
  return client;
}

// ── TokenPurchaseWidget component ─────────────────────────────────────────────

// Props:
//   params          — _widget_params from the create intent response.
//                     Provide this OR clientSecret, not both.
//   clientSecret    — tpi_…_secret_… from the create intent response.
//                     Widget fetches its own params on mount.
//   intentId        — the tpi_… ID (optional, passed to onSuccess)
//   onReady         — () => void
//   onChange        — ({ state, step }) => void
//   onSuccess       — ({ intentId, txHash }) => void
//   onError         — ({ code, message, retryable }) => void
//   onPriceChange   — ({ oldPrice, newPrice, confirmed, canceled }) => void
//   appearance      — { theme, variables, rules }
//   className       — applied to the host div
//   style           — applied to the host div
export function TokenPurchaseWidget({
  params,
  clientSecret,
  intentId,
  onReady,
  onChange,
  onSuccess,
  onError,
  onPriceChange,
  appearance,
  className,
  style,
}) {
  const client       = usePlatformClient();
  const containerRef = useRef(null);
  const widgetRef    = useRef(null);

  // The effect re-runs when either params or clientSecret changes. Exactly one
  // must be provided; the widget constructor will throw if neither or both are.
  const initKey = params ?? clientSecret;

  useEffect(() => {
    if (!client || !containerRef.current || !initKey) return;

    const widget = client.tokenPurchaseWidget({
      params,
      clientSecret,
      intentId,
      onReady,
      onChange,
      onSuccess,
      onError,
      onPriceChange,
      appearance,
    });

    widget.mount(containerRef.current);
    widgetRef.current = widget;

    return () => {
      widget.destroy();
      widgetRef.current = null;
    };
  }, [client, initKey]);

  return <div ref={containerRef} className={className} style={style} />;
}
