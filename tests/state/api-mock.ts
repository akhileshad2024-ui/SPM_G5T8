// The fake apiFetch the state tests share. Kept in its own file (it imports nothing from lib/)
// so the vi.mock factory in each test file can load it without an import cycle:
//
//   vi.mock("../../lib/api/client", async (original) => ({
//     ...(await original<typeof import("../../lib/api/client")>()),
//     apiFetch: (await import("./api-mock")).apiFetch,
//   }));
import { vi } from "vitest";

export const apiFetch = vi.fn();

/**
 * What the provider handed to useIdleSignOut (lib/auth/idle-timeout), so a test can fire the
 * idle sign-out and the keep-alive failure itself instead of waiting 30 minutes:
 *
 *   vi.mock("../../lib/auth/idle-timeout", async (original) => ({
 *     ...(await original<typeof import("../../lib/auth/idle-timeout")>()),
 *     useIdleSignOut: (await import("./api-mock")).useIdleSignOutSpy,
 *   }));
 */
export const idle: {
  active: boolean;
  onIdle: () => Promise<void>;
  onKeepAliveError: (err: unknown) => void;
} = { active: false, onIdle: async () => {}, onKeepAliveError: () => {} };

export function useIdleSignOutSpy(active: boolean, onIdle: () => Promise<void>, onKeepAliveError: (err: unknown) => void) {
  Object.assign(idle, { active, onIdle, onKeepAliveError });
}
