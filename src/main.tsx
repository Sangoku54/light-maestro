import React from 'react';
import ReactDOM from 'react-dom/client';
import './i18n';
import App from './App';

// Nuke corrupted localStorage from previous version (songPresets base64 overflowed quota).
// showStore persistence has been moved to filesystem via Electron IPC.
try { localStorage.removeItem('light-maestro-show'); } catch { /* */ }

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
