import React from 'react';
import { createRoot } from 'react-dom/client';
import HybridFieldApp from './HybridFieldApp';

createRoot(document.getElementById('root')).render(<HybridFieldApp />);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
