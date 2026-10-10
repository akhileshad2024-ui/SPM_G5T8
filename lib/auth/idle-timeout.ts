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
import { apiFetch } from "../api/client";

/** Keep in sync with SESSION_IDLE_MINUTES in backend/.env. */
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
export const KEEPALIVE_MS = 5 * 60 * 1000;
export const CHECK_MS = 15 * 1000;
export const STORAGE_KEY = "cs_last_activity";
export const ACTIVITY_EVENTS = ["mousedown", "keydown", "wheel", "scroll", "touchstart"] as const;

/** Shared last-activity store; localStorage in the browser, injectable for tests. */
export interface ActivityStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface IdleTrackerOptions {
  onIdle: () => void;
  onKeepAliveError: (err: unknown) => void;
  /** Renews the server session (GET /auth/me). */
  ping?: () => Promise<unknown>;
  /** Where activity events are heard (window) and visibility changes are reported (document). */
  activityTarget?: EventTarget;
  visibility?: EventTarget & { visibilityState: string };
  store?: ActivityStore | null;
}

function browserStore(): ActivityStore | null {
  try {
    return localStorage;
  } catch {
    return null; // storage unavailable (private mode etc.) — this tab's own timer still works
  }
}

function readShared(store: ActivityStore | null): number {
  try {
    return Number(store?.getItem(STORAGE_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeShared(store: ActivityStore | null, time: number) {
  try {
    store?.setItem(STORAGE_KEY, String(time));
  } catch {
    // quota exceeded / storage disabled — this tab's own timer still works
  }
}

/**
 * Starts watching for activity: calls `onIdle` after IDLE_TIMEOUT_MS without
 * activity in any tab, and `onKeepAliveError` if a keep-alive ping fails (e.g.
 * 401: session already gone). Returns a function that stops tracking.
 */
export function startIdleTracker({
  onIdle,
  onKeepAliveError,
  ping = () => apiFetch("/auth/me"),
  activityTarget = window,
  visibility = document,
  store = browserStore(),
}: IdleTrackerOptions): () => void {
  let lastActivity = Date.now();
  let lastShared = lastActivity;
  let lastPing = lastActivity;
  writeShared(store, lastActivity);

  // Pinging only after fresh activity keeps the server session alive at least
  // as long as this timer, without holding it open for an idle user.
  const keepAlive = (now: number) => {
    if (lastActivity > lastPing && now - lastPing >= KEEPALIVE_MS) {
      lastPing = now;
      ping().catch(onKeepAliveError);
    }
  };

  const onActivity = () => {
    lastActivity = Date.now();
    if (lastActivity - lastShared >= 1000) {
      writeShared(store, lastActivity);
      lastShared = lastActivity;
    }
    // Renew right away rather than on the next tick: after a long pause the server
    // session may be close to lapsing, and timers can be delayed (throttling, sleep).
    keepAlive(lastActivity);
  };

  const check = () => {
    const now = Date.now();
    if (now - Math.max(lastActivity, readShared(store)) >= IDLE_TIMEOUT_MS) {
      onIdle();
      return;
    }
    keepAlive(now);
  };

  // Timers are throttled in background tabs and paused during sleep, so re-check on return.
  const onVisible = () => {
    if (visibility.visibilityState === "visible") check();
  };

  ACTIVITY_EVENTS.forEach((type) => activityTarget.addEventListener(type, onActivity, { passive: true, capture: true }));
  visibility.addEventListener("visibilitychange", onVisible);
  const timer = setInterval(check, CHECK_MS);

  return () => {
    ACTIVITY_EVENTS.forEach((type) => activityTarget.removeEventListener(type, onActivity, { capture: true }));
    visibility.removeEventListener("visibilitychange", onVisible);
    clearInterval(timer);
  };
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
    return startIdleTracker({
      onIdle: () => callbacks.current.onIdle(),
      onKeepAliveError: (err) => callbacks.current.onKeepAliveError(err),
    });
  }, [active]);
}
