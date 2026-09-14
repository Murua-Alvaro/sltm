import React from 'react';
import { createRoot } from 'react-dom/client';
import ModernFieldApp from './ModernFieldApp';

createRoot(document.getElementById('root')).render(<ModernFieldApp />);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
