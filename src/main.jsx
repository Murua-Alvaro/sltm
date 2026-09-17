import React from 'react';
import { createRoot } from 'react-dom/client';
import FieldFlowApp from './FieldFlowApp';

createRoot(document.getElementById('root')).render(<FieldFlowApp />);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}