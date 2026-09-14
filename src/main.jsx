import React from 'react';
import { createRoot } from 'react-dom/client';
import FieldLiveApp from './FieldLiveApp';

createRoot(document.getElementById('root')).render(<FieldLiveApp />);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
