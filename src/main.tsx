import './sentry';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { registerServiceWorker } from './registerServiceWorker';
import { initializePWAInstall } from './services/pwaInstall';

import { ErrorBoundary } from './components/ErrorBoundary';

initializePWAInstall();
registerServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
