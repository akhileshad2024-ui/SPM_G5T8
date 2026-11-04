// @vitest-environment jsdom
/**
 * US01 - AC4 (frontend): the React hook that signs a user out after 30 minutes of inactivity.
 *
 * Unit tests for useIdleSignOut (lib/auth/idle-timeout.ts): it starts the tracker only while
 * `active`, always calls the latest callbacks, pings the server through apiFetch("/auth/me")
 * after fresh activity, and stops tracking on unmount. Fake timers; apiFetch is mocked.
 */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api/client", () => ({ apiFetch }));

import { IDLE_TIMEOUT_MS, KEEPALIVE_MS, useIdleSignOut } from "../../lib/auth/idle-timeout";

beforeEach(() => {
  vi.useFakeTimers();
  apiFetch.mockReset();
  apiFetch.mockResolvedValue({});
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
});

function mount(active = true) {
  const onIdle = vi.fn();
  const onKeepAliveError = vi.fn();
  const view = renderHook(
    (props: { active: boolean; onIdle: () => void; onKeepAliveError: (err: unknown) => void }) =>
      useIdleSignOut(props.active, props.onIdle, props.onKeepAliveError),
    { initialProps: { active, onIdle, onKeepAliveError } },
  );
  return { ...view, onIdle, onKeepAliveError };
}

describe("useIdleSignOut", () => {
  it("signs the user out after the idle timeout while active", () => {
    const { onIdle } = mount(true);

    vi.advanceTimersByTime(IDLE_TIMEOUT_MS + 60_000);

    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it("does not track anything while inactive", () => {
    const { onIdle } = mount(false);

    vi.advanceTimersByTime(IDLE_TIMEOUT_MS * 2);
    window.dispatchEvent(new Event("keydown"));

    expect(onIdle).not.toHaveBeenCalled();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("starts tracking when it becomes active and stops when it becomes inactive again", () => {
    const { rerender, onIdle, onKeepAliveError } = mount(false);

    rerender({ active: true, onIdle, onKeepAliveError });
    vi.advanceTimersByTime(IDLE_TIMEOUT_MS + 60_000);
    expect(onIdle).toHaveBeenCalledTimes(1);

    const second = vi.fn();
    rerender({ active: false, onIdle: second, onKeepAliveError });
    rerender({ active: true, onIdle: second, onKeepAliveError });
    vi.advanceTimersByTime(IDLE_TIMEOUT_MS + 60_000);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("calls the latest onIdle callback, not the one from the first render", () => {
    const { rerender, onIdle, onKeepAliveError } = mount(true);
    const latest = vi.fn();

    rerender({ active: true, onIdle: latest, onKeepAliveError });
    vi.advanceTimersByTime(IDLE_TIMEOUT_MS + 60_000);

    expect(latest).toHaveBeenCalledTimes(1);
    expect(onIdle).not.toHaveBeenCalled();
  });

  it("renews the server session through /auth/me after fresh activity", () => {
    mount(true);

    vi.advanceTimersByTime(KEEPALIVE_MS + 1000);
    window.dispatchEvent(new Event("keydown"));

    expect(apiFetch).toHaveBeenCalledWith("/auth/me");
  });

  it("reports a failed keep-alive ping to the latest onKeepAliveError", async () => {
    const failure = new Error("401");
    apiFetch.mockRejectedValue(failure);
    const { rerender, onIdle, onKeepAliveError } = mount(true);
    const latest = vi.fn();
    rerender({ active: true, onIdle, onKeepAliveError: latest });

    vi.advanceTimersByTime(KEEPALIVE_MS + 1000);
    window.dispatchEvent(new Event("keydown"));
    await vi.advanceTimersByTimeAsync(0);

    expect(latest).toHaveBeenCalledWith(failure);
    expect(onKeepAliveError).not.toHaveBeenCalled();
  });

  it("stops tracking when the component unmounts", () => {
    const { unmount, onIdle } = mount(true);

    unmount();
    vi.advanceTimersByTime(IDLE_TIMEOUT_MS * 2);

    expect(onIdle).not.toHaveBeenCalled();
  });
});
