import React from 'react';
import { createRoot } from 'react-dom/client';
import DemoApp from './DemoApp';

createRoot(document.getElementById('root')).render(<DemoApp />);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
