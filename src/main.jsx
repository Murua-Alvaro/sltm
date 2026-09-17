import React from 'react';
import { createRoot } from 'react-dom/client';
import RealSiteApp from './RealSiteApp';

createRoot(document.getElementById('root')).render(<RealSiteApp />);

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}