/**
 * Renderer watchdog — fail-safe blackout heartbeat.
 *
 * The renderer's output pipeline (RAF playback loop) is the only writer of
 * DMX values. If the renderer crashes or hangs, those values would otherwise
 * stay on the wire forever. The main process arms a fail-safe: after the
 * first `watchdog:ping` is received, if no ping arrives for more than
 * WATCHDOG_TIMEOUT_MS (4 s), it blacks out every output and stops the DMX
 * engine. When the renderer pings again the blackout is auto-lifted, so a
 * transient stall never leaves DMX dead for the rest of the session.
 *
 * This module keeps that heartbeat alive (one ping every 500 ms on the
 * `watchdog:ping` IPC channel). It self-initializes on import and degrades
 * gracefully: in a pure web environment (no Electron preload bridge) it is a
 * strict no-op, so nothing breaks.
 */

const PING_INTERVAL_MS = 500;

let watchdogTimer: ReturnType<typeof setInterval> | null = null;
let started = false;

/** Start pinging the main process. Safe to call multiple times (idempotent). */
export function startRendererWatchdog(): void {
  if (started) return;
  started = true;

  if (typeof window === 'undefined') return; // non-browser environment

  const bridge = (window as any)?.lightMaestro;
  const ping = bridge?.watchdog?.ping;
  if (typeof ping !== 'function') {
    // No Electron preload bridge (pure web dev / browser): nothing to ping,
    // and nothing should break because of it.
    return;
  }

  watchdogTimer = setInterval(() => {
    try {
      ping();
    } catch {
      // The heartbeat must never take the app down with it.
    }
  }, PING_INTERVAL_MS);
}

/** Stop pinging (mainly useful for tests / HMR). */
export function stopRendererWatchdog(): void {
  if (watchdogTimer !== null) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
  started = false;
}

// Self-initialize at import time (the renderer entry point imports this module).
startRendererWatchdog();

// Vite HMR cleanup (dev only): avoid stacking duplicate intervals on hot reload.
if ((import.meta as any).hot) {
  (import.meta as any).hot.dispose(() => stopRendererWatchdog());
}
