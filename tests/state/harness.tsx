/**
 * Test harness for lib/state/app-context.tsx: renders the real AppProvider with a fake backend.
 *
 * Every backend call goes through `apiFetch`, which is answered from a route table keyed
 * "METHOD /path". `mountApp()` registers sensible empty answers for what the provider loads
 * after sign-in, so a test only adds the routes it cares about:
 *
 *   const m = await mountApp({ role: "coordinator", events: [stored(1)] });
 *   route("POST /events/1/confirm", stored(1, { status: "confirmed" }));
 *   await act2(() => m.app.confirmEvent("EVT-1"));
 *   expect(m.app.state.toast).toContain("confirmed");
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { expect } from "vitest";
import { ApiError } from "../../lib/api/client";
import { PEOPLE } from "../../lib/data/seed";
import type { StoredEvent } from "../../lib/events/request/api";
import { AppProvider, useApp } from "../../lib/state/app-context";
import type { AuthUser, Role, VenueBookingRecord } from "../../lib/types";
import { apiFetch } from "./api-mock";

export { apiFetch };

type Responder = unknown | ((body: any, path: string) => unknown);
const routes = new Map<string, Responder>();

/** Answer `key` ("GET /events") with a value, or with a function of the parsed request body. */
export function route(key: string, answer: Responder) {
  routes.set(key, answer);
}

/** Make `key` fail the way the backend does. */
export function fail(key: string, status: number, message = "Something failed", fields: Record<string, string> = {}) {
  routes.set(key, () => {
    throw new ApiError(status, message, fields);
  });
}

/** The bodies sent to `key`, parsed (null when a call had none). */
export function bodies(key: string): unknown[] {
  return apiFetch.mock.calls
    .filter(([path, init]) => `${init?.method ?? "GET"} ${path}` === key)
    .map(([, init]) => (init?.body ? JSON.parse(init.body) : null));
}

/** How many times `key` was called. */
export const called = (key: string) => bodies(key).length;

apiFetch.mockImplementation(async (path: string, init?: { method?: string; body?: string }) => {
  const key = `${init?.method ?? "GET"} ${path}`;
  if (!routes.has(key)) throw new Error(`No test route for ${key}`);
  const answer = routes.get(key);
  return typeof answer === "function" ? answer(init?.body ? JSON.parse(init.body) : null, path) : answer;
});

/** Call in beforeEach. */
export function resetApi() {
  routes.clear();
  apiFetch.mockClear();
}

/** A stored event as the backend sends it (organiser's view, submitted, nothing arranged yet). */
export function stored(id: number, overrides: Partial<StoredEvent> = {}): StoredEvent {
  return {
    id, status: "submitted", name: `Event ${id}`, organiser: "Maya Rahman", updatedAt: "2026-10-08T09:23:00Z",
    purpose: "Eight student ventures pitch to investors.", eventType: "networking",
    date: "2026-11-26", start: "18:30:00", end: "21:00:00", coordinator: null, pax: 95, layout: "banquet",
    facilities: [], access: [], equip: [], reg: false, regCap: null, regClose: null, registered: 0,
    venue: null, venueName: null, bookingState: null, equipState: null, submittedAt: "2026-10-01T02:00:00Z",
    ...overrides,
  };
}

export function user(role: Role, overrides: Partial<AuthUser> = {}): AuthUser {
  return { id: 1, name: PEOPLE[role].person, email: PEOPLE[role].email, role, ...overrides };
}

interface MountOptions {
  role?: Role;
  /** False: GET /auth/me answers 401, as when nobody is signed in. */
  signedIn?: boolean;
  events?: StoredEvent[];
  bookings?: VenueBookingRecord[];
  /** Routes to add or replace before the provider mounts. */
  routes?: Record<string, Responder>;
}

/** Let promises queued by effects and handlers finish. */
export const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

export async function mountApp({ role = "coordinator", signedIn = true, events = [], bookings = [], routes: extra = {} }: MountOptions = {}) {
  const me = user(role);
  if (signedIn) route("GET /auth/me", me);
  else fail("GET /auth/me", 401, "Not signed in");
  route("GET /events", events);
  route("GET /bookings", bookings);
  route("GET /notifications", []);
  route("POST /notifications/read", undefined);
  route("GET /venues", []);
  route("GET /venues?include_inactive=true", []);
  route("GET /registrations/me", []);
  route("GET /coordinators", []);
  route("GET /safety-checks", []);
  route("POST /auth/logout", undefined);
  route("POST /auth/logout?all_sessions=false", undefined);
  for (const [key, answer] of Object.entries(extra)) route(key, answer);

  const hook = renderHook(() => useApp(), {
    wrapper: ({ children }: { children: ReactNode }) => createElement(AppProvider, null, children),
  });
  await waitFor(() => expect(hook.result.current.state.authChecked).toBe(true));
  if (signedIn) await waitFor(() => expect(hook.result.current.state.events.length).toBe(events.length));
  await flush();
  return {
    /** The latest app api: read it again after every action, it is rebuilt when state changes. */
    get app() {
      return hook.result.current;
    },
    hook,
    me,
  };
}

/** Run an action inside act() and return what it returns. */
export async function act2<T>(fn: () => T | Promise<T>): Promise<T> {
  let out!: T;
  await act(async () => {
    out = await fn();
  });
  return out;
}

