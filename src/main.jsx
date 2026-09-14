import React from 'react';
import { createRoot } from 'react-dom/client';
import SmartTraverseApp from './SmartTraverseApp';

createRoot(document.getElementById('root')).render(<SmartTraverseApp />);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
