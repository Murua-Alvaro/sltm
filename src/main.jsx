import React from 'react';
import { createRoot } from 'react-dom/client';
import InstrumentedOpsApp from './InstrumentedOpsApp';

createRoot(document.getElementById('root')).render(<InstrumentedOpsApp />);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
