import React from 'react';
import ReactDOM from 'react-dom/client';
import './i18n';
import './utils/renderer-watchdog';
import App from './App';

// Nuke corrupted localStorage from previous version (songPresets base64 overflowed quota).
// showStore persistence has been moved to filesystem via Electron IPC.
try { localStorage.removeItem('light-maestro-show'); } catch { /* */ }

console.log('%cLight Maestro %c24 commits %cdmxBridge', 'color:#0ff;font-size:16px', 'color:#fa0', 'color:#0f0');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
