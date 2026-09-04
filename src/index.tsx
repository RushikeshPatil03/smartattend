import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import App from './App';
import { AppProvider } from './store';
import { ErrorBoundary } from './components/ErrorBoundary';
import './index.css';
import { initDeviceFingerprint } from './services/attendanceClient';

// Auto-recover from stale chunks after new deployments
if (typeof window !== "undefined") {
  window.addEventListener("vite:preloadError", (event) => {
    event.preventDefault();
    if ("caches" in window) {
      caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k)))).catch(() => {});
    }
    window.location.reload();
  });
}

// Initialize device identity early so IndexedDB is ready before any login/attendance flow
void initDeviceFingerprint();

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = createRoot(rootElement);

root.render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AppProvider>
          <App />
        </AppProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
