import { createContext, useContext, useEffect, useRef, useState } from 'react';
import { loadXmagnet } from '@platform/js';

// ── Context ───────────────────────────────────────────────────────────────────

const XmagnetContext = createContext(null);

// Initialises the Xmagnet SDK once at the tree root. All TokenPurchaseWidget
// instances in the tree share this initialisation.
//
//   <XmagnetProvider publishableKey={process.env.NEXT_PUBLIC_PLATFORM_KEY}>
//     ...
//   </XmagnetProvider>
export function XmagnetProvider({ publishableKey, options = {}, children }) {
  const [xmagnet, setXmagnet] = useState(null);

  useEffect(() => {
    if (!publishableKey) return;
    loadXmagnet(publishableKey, options).then(setXmagnet);
  }, [publishableKey]);

  return (
    <XmagnetContext.Provider value={xmagnet}>
      {children}
    </XmagnetContext.Provider>
  );
}

function useXmagnet() {
  const xmagnet = useContext(XmagnetContext);
  if (!xmagnet) throw new Error('TokenPurchaseWidget must be used inside <XmagnetProvider>.');
  return xmagnet;
}

// ── TokenPurchaseWidget component ─────────────────────────────────────────────

// Props:
//   params          — _widget_params from the create intent response (required)
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
  const xmagnet     = useXmagnet();
  const containerRef = useRef(null);
  const widgetRef    = useRef(null);

  useEffect(() => {
    if (!xmagnet || !containerRef.current || !params) return;

    // Create and mount the widget
    const widget = xmagnet.tokenPurchaseWidget({
      params,
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
  }, [xmagnet, params]);

  // Surface the imperative widget object via ref if the parent needs it,
  // but most use cases only need callbacks.

  return <div ref={containerRef} className={className} style={style} />;
}
