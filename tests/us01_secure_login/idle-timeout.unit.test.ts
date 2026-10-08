/**
 * US01 — AC4 (frontend): the session is terminated after 30 minutes of inactivity.
 *
 * Unit tests for startIdleTracker (lib/idle-timeout.ts), with fake timers and an
 * in-memory activity store instead of the browser's window/document/localStorage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ACTIVITY_EVENTS,
  CHECK_MS,
  IDLE_TIMEOUT_MS,
  KEEPALIVE_MS,
  STORAGE_KEY,
  startIdleTracker,
  type ActivityStore,
} from "../../lib/idle-timeout";

const MINUTE = 60 * 1000;

class FakeDocument extends EventTarget {
  visibilityState = "visible";
}

function memoryStore(): ActivityStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

function setup(overrides: { store?: ActivityStore | null; ping?: () => Promise<unknown> } = {}) {
  const page = new EventTarget();
  const doc = new FakeDocument();
  const store = overrides.store === undefined ? memoryStore() : overrides.store;
  const onIdle = vi.fn();
  const onKeepAliveError = vi.fn();
  const ping = vi.fn(overrides.ping ?? (() => Promise.resolve()));
  const stop = startIdleTracker({ onIdle, onKeepAliveError, ping, activityTarget: page, visibility: doc, store });
  const act = (type = "keydown") => page.dispatchEvent(new Event(type));
  return { page, doc, store, onIdle, onKeepAliveError, ping, stop, act };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-06T09:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("idle sign-out", () => {
  it("uses a 30-minute idle window", () => {
    expect(IDLE_TIMEOUT_MS).toBe(30 * MINUTE);
  });

  it("does not sign out before 30 minutes without activity", () => {
    const t = setup();
    vi.advanceTimersByTime(30 * MINUTE - CHECK_MS);
    expect(t.onIdle).not.toHaveBeenCalled();
  });

  it("signs out once 30 minutes pass without activity", () => {
    const t = setup();
    vi.advanceTimersByTime(30 * MINUTE);
    expect(t.onIdle).toHaveBeenCalled();
  });

  it("restarts the 30 minutes on every activity", () => {
    const t = setup();
    vi.advanceTimersByTime(20 * MINUTE);
    t.act();
    vi.advanceTimersByTime(20 * MINUTE);
    expect(t.onIdle).not.toHaveBeenCalled();

    vi.advanceTimersByTime(10 * MINUTE);
    expect(t.onIdle).toHaveBeenCalled();
  });

  it.each(ACTIVITY_EVENTS)("counts '%s' as activity", (type) => {
    const t = setup();
    vi.advanceTimersByTime(25 * MINUTE);
    t.act(type);
    vi.advanceTimersByTime(25 * MINUTE);
    expect(t.onIdle).not.toHaveBeenCalled();
  });

  it("does not count mouse movement alone as activity", () => {
    const t = setup();
    vi.advanceTimersByTime(25 * MINUTE);
    t.act("mousemove");
    vi.advanceTimersByTime(5 * MINUTE);
    expect(t.onIdle).toHaveBeenCalled();
  });

  it("checks immediately when the tab becomes visible again (timers may have been paused)", () => {
    const t = setup();
    vi.setSystemTime(Date.now() + 31 * MINUTE); // e.g. the laptop slept; no timer ticks ran
    t.doc.dispatchEvent(new Event("visibilitychange"));
    expect(t.onIdle).toHaveBeenCalledTimes(1);
  });

  it("ignores visibility changes to a hidden tab", () => {
    const t = setup();
    vi.setSystemTime(Date.now() + 31 * MINUTE);
    t.doc.visibilityState = "hidden";
    t.doc.dispatchEvent(new Event("visibilitychange"));
    expect(t.onIdle).not.toHaveBeenCalled();
  });

  it("stops tracking once stopped (e.g. after sign-out)", () => {
    const t = setup();
    t.stop();
    t.act();
    vi.advanceTimersByTime(60 * MINUTE);
    expect(t.onIdle).not.toHaveBeenCalled();
    expect(t.ping).not.toHaveBeenCalled();
  });
});

describe("activity shared across tabs", () => {
  it("records the sign-in time as the last activity", () => {
    const t = setup();
    expect(Number(t.store!.getItem(STORAGE_KEY))).toBe(Date.now());
  });

  it("records activity for the other tabs", () => {
    const t = setup();
    vi.advanceTimersByTime(2 * MINUTE);
    t.act();
    expect(Number(t.store!.getItem(STORAGE_KEY))).toBe(Date.now());
  });

  it("writes to storage at most once a second", () => {
    const store = memoryStore();
    const setItem = vi.spyOn(store, "setItem");
    const t = setup({ store });
    setItem.mockClear();
    vi.advanceTimersByTime(1000);
    t.act();
    t.act();
    t.act();
    expect(setItem).toHaveBeenCalledTimes(1);
  });

  it("does not sign out while the user is active in another tab", () => {
    const t = setup();
    vi.advanceTimersByTime(25 * MINUTE);
    t.store!.setItem(STORAGE_KEY, String(Date.now())); // activity in another tab
    vi.advanceTimersByTime(25 * MINUTE);
    expect(t.onIdle).not.toHaveBeenCalled();
  });

  it("still signs out when storage is unavailable", () => {
    const t = setup({ store: null });
    vi.advanceTimersByTime(30 * MINUTE);
    expect(t.onIdle).toHaveBeenCalled();
  });

  it("tolerates storage that throws (private mode, quota)", () => {
    const broken: ActivityStore = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    const t = setup({ store: broken });
    t.act();
    vi.advanceTimersByTime(30 * MINUTE);
    expect(t.onIdle).toHaveBeenCalled();
  });
});

describe("browser defaults", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("listens on window/document and stores activity in localStorage", () => {
    const win = new EventTarget();
    const doc = new FakeDocument();
    const storage = memoryStore();
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", doc);
    vi.stubGlobal("localStorage", storage);
    const onIdle = vi.fn();

    const stop = startIdleTracker({ onIdle, onKeepAliveError: vi.fn(), ping: () => Promise.resolve() });
    vi.advanceTimersByTime(20 * MINUTE);
    win.dispatchEvent(new Event("keydown"));

    expect(Number(storage.getItem(STORAGE_KEY))).toBe(Date.now());
    vi.advanceTimersByTime(20 * MINUTE);
    expect(onIdle).not.toHaveBeenCalled();
    stop();
  });

  it("works without localStorage when the browser blocks it", () => {
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("document", new FakeDocument());
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });
    const onIdle = vi.fn();

    try {
      const stop = startIdleTracker({ onIdle, onKeepAliveError: vi.fn(), ping: () => Promise.resolve() });
      vi.advanceTimersByTime(30 * MINUTE);
      expect(onIdle).toHaveBeenCalled();
      stop();
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });

  it("renews the session with GET /api/auth/me", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify({}), { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    const page = new EventTarget();

    const stop = startIdleTracker({
      onIdle: vi.fn(),
      onKeepAliveError: vi.fn(),
      activityTarget: page,
      visibility: new FakeDocument(),
      store: null,
    });
    vi.advanceTimersByTime(KEEPALIVE_MS);
    page.dispatchEvent(new Event("keydown"));
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledWith("/api/auth/me", expect.objectContaining({ credentials: "same-origin" }));
    stop();
  });
});

describe("keep-alive (renewing the server session)", () => {
  it("never pings an idle user, so their server session can lapse", () => {
    const t = setup();
    vi.advanceTimersByTime(29 * MINUTE);
    expect(t.ping).not.toHaveBeenCalled();
  });

  it("pings as soon as the user is active after a long pause, without waiting for the timer", () => {
    const t = setup();
    vi.advanceTimersByTime(29 * MINUTE);
    t.act();
    expect(t.ping).toHaveBeenCalledTimes(1);
  });

  it("pings at most once every 5 minutes during continuous activity", () => {
    const t = setup();
    for (let i = 0; i < 20; i++) {
      vi.advanceTimersByTime(30 * 1000);
      t.act();
    }
    // 10 minutes of activity -> at the 5- and 10-minute marks only
    expect(t.ping).toHaveBeenCalledTimes(2);
  });

  it("does not ping before 5 minutes have passed since the last renewal", () => {
    const t = setup();
    vi.advanceTimersByTime(KEEPALIVE_MS - 1000);
    t.act();
    expect(t.ping).not.toHaveBeenCalled();
  });

  it("pings on the next check when activity happened since the last renewal", () => {
    const t = setup();
    vi.advanceTimersByTime(KEEPALIVE_MS - 1000);
    t.act(); // too early to ping now
    vi.advanceTimersByTime(CHECK_MS);
    expect(t.ping).toHaveBeenCalledTimes(1);
  });

  it("reports a failed renewal (e.g. 401: session already ended on the server)", async () => {
    const failure = new Error("401");
    const t = setup({ ping: () => Promise.reject(failure) });
    vi.advanceTimersByTime(KEEPALIVE_MS);
    t.act();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.onKeepAliveError).toHaveBeenCalledWith(failure);
  });
});
