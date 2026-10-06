/**
 * Inactivity sign-out (US01: "session terminated after 30 minutes of inactivity").
 *
 * The backend renews the session cookie on every signed-in request and lets it
 * lapse after SESSION_IDLE_MINUTES without one. Most pages here work on
 * in-memory data and never call the backend, so this hook does the other half:
 * it watches for real activity, pings the backend now and then while the user
 * is active (keeping the server session alive), and signs out once the user has
 * been idle for the full window. The last-activity time is shared through
 * localStorage so activity in one tab counts for every tab.
 */

import { useEffect, useRef } from "react";
import { apiFetch } from "./api";

/** Keep in sync with SESSION_IDLE_MINUTES in backend/.env. */
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const KEEPALIVE_MS = 5 * 60 * 1000;
const CHECK_MS = 15 * 1000;
const STORAGE_KEY = "cs_last_activity";
const ACTIVITY_EVENTS = ["mousedown", "keydown", "wheel", "scroll", "touchstart"] as const;

function readShared(): number {
  try {
    return Number(localStorage.getItem(STORAGE_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeShared(time: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(time));
  } catch {
    // storage unavailable (private mode etc.) — this tab's own timer still works
  }
}

/**
 * While `active`, calls `onIdle` after IDLE_TIMEOUT_MS without activity in any tab,
 * and `onKeepAliveError` if a keep-alive ping fails (e.g. 401: session already gone).
 */
export function useIdleSignOut(active: boolean, onIdle: () => void, onKeepAliveError: (err: unknown) => void) {
  const callbacks = useRef({ onIdle, onKeepAliveError });
  useEffect(() => {
    callbacks.current = { onIdle, onKeepAliveError };
  });

  useEffect(() => {
    if (!active) return;

    let lastActivity = Date.now();
    let lastShared = lastActivity;
    let lastPing = lastActivity;
    writeShared(lastActivity);

    const onActivity = () => {
      lastActivity = Date.now();
      if (lastActivity - lastShared >= 1000) {
        writeShared(lastActivity);
        lastShared = lastActivity;
      }
    };

    const check = () => {
      const now = Date.now();
      if (now - Math.max(lastActivity, readShared()) >= IDLE_TIMEOUT_MS) {
        callbacks.current.onIdle();
        return;
      }
      // Pinging only after fresh activity keeps the server session alive at least
      // as long as this timer, without holding it open for an idle user.
      if (lastActivity > lastPing && now - lastPing >= KEEPALIVE_MS) {
        lastPing = now;
        apiFetch("/auth/me").catch((err) => callbacks.current.onKeepAliveError(err));
      }
    };

    // Timers are throttled in background tabs and paused during sleep, so re-check on return.
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };

    ACTIVITY_EVENTS.forEach((type) => window.addEventListener(type, onActivity, { passive: true, capture: true }));
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(check, CHECK_MS);

    return () => {
      ACTIVITY_EVENTS.forEach((type) => window.removeEventListener(type, onActivity, { capture: true }));
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [active]);
}
