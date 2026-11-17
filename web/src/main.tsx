import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Root } from './session';
import { DEMO } from './demo';
import './index.css';

createRoot(document.getElementById('root')!).render(<StrictMode><Root /></StrictMode>);

if ('serviceWorker' in navigator && import.meta.env.PROD && !DEMO) {
  window.addEventListener('load', async () => {
    try {
      await navigator.serviceWorker.register('/sw.js');
      const reg = await navigator.serviceWorker.ready;
      // Hashed bundles loaded before the worker took control are added to the offline shell explicitly.
      const urls = [...document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>('script[src], link[rel="stylesheet"], link[rel="modulepreload"]')]
        .map((el) => ('src' in el && el.src ? el.src : (el as HTMLLinkElement).href)).filter((u) => u.startsWith(location.origin));
      reg.active?.postMessage({ type: 'cache-urls', urls });
    } catch { /* offline shell is optional */ }
  });
}
