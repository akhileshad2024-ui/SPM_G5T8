// @vitest-environment jsdom
/**
 * lib/state/app-context.tsx: the session (restore, sign in/out, idle, expiry), the toast, error
 * handling, notifications, selection and the data loaded after sign-in.
 */
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../lib/api/client";
import { PEOPLE } from "../../lib/data/seed";
import { useApp } from "../../lib/state/app-context";
import { router, resetNext } from "../helpers/next-mocks";
import { idle } from "./api-mock";
import { act2, bodies, called, fail, flush, mountApp, resetApi, route, stored, user } from "./harness";

vi.mock("next/navigation", async () => (await import("../helpers/next-mocks")).nextNavigation);
vi.mock("../../lib/api/client", async (original) => ({
  ...(await original<typeof import("../../lib/api/client")>()),
  apiFetch: (await import("./api-mock")).apiFetch,
}));
vi.mock("../../lib/auth/idle-timeout", async (original) => ({
  ...(await original<typeof import("../../lib/auth/idle-timeout")>()),
  useIdleSignOut: (await import("./api-mock")).useIdleSignOutSpy,
}));

beforeEach(() => {
  resetApi();
  resetNext();
});
afterEach(() => vi.useRealTimers());

describe("restoring the session on load", () => {
  it("signs the person back in from their cookie and shows who they are", async () => {
    const m = await mountApp({ role: "organiser" });

    expect(m.app.state).toMatchObject({ authChecked: true, authed: true, role: "organiser" });
    expect(m.app.me).toEqual({ person: PEOPLE.organiser.person, label: "Event Organiser", email: PEOPLE.organiser.email });
  });

  it("uses the signed-in account's own name and email rather than the sample person's", async () => {
    const m = await mountApp({ role: "coordinator" });
    route("GET /auth/me", user("coordinator", { name: "Marcus Lee", email: "marcus.lee@connectsphere.edu" }));
    const again = await mountApp({ role: "coordinator", routes: { "GET /auth/me": user("coordinator", { name: "Marcus Lee", email: "marcus.lee@connectsphere.edu" }) } });

    expect(m.app.me.person).toBe("Priya Tan");
    expect(again.app.me).toMatchObject({ person: "Marcus Lee", email: "marcus.lee@connectsphere.edu" });
  });

  it("stays signed out when there is no session, and shows the role's sample person", async () => {
    const m = await mountApp({ signedIn: false });

    expect(m.app.state).toMatchObject({ authChecked: true, authed: false, user: null });
    expect(m.app.me).toEqual(PEOPLE.coordinator);
    expect(called("GET /events")).toBe(0);
  });
});

describe("signIn", () => {
  it("asks for an email and a password before calling the server", async () => {
    const m = await mountApp({ signedIn: false });

    expect(await act2(() => m.app.signIn(undefined as never, "pw"))).toEqual({ ok: false, error: "Enter your work email to continue." });
    expect(await act2(() => m.app.signIn("   ", "pw"))).toEqual({ ok: false, error: "Enter your work email to continue." });
    expect(await act2(() => m.app.signIn("a@b.edu", ""))).toEqual({ ok: false, error: "Enter your password." });
    expect(called("POST /auth/login")).toBe(0);
  });

  it("signs in with a trimmed, lower-case email and goes to the role's first page", async () => {
    const m = await mountApp({ signedIn: false });
    route("POST /auth/login", user("venue"));

    const result = await act2(() => m.app.signIn("  Daniel.Ortiz@ConnectSphere.edu ", "secret"));

    expect(result).toEqual({ ok: true });
    expect(bodies("POST /auth/login")).toEqual([{ email: "daniel.ortiz@connectsphere.edu", password: "secret" }]);
    expect(m.app.state).toMatchObject({ authed: true, role: "venue", signInNotice: null });
    expect(m.app.state.toast).toContain("Signed in as Daniel Ortiz");
    expect(router.push).toHaveBeenCalledWith("/bookings");
  });

  it.each([401, 429])("shows the server's message for a %i", async (status) => {
    const m = await mountApp({ signedIn: false });
    fail("POST /auth/login", status, "Incorrect email or password");

    expect(await act2(() => m.app.signIn("a@b.edu", "x"))).toEqual({ ok: false, error: "Incorrect email or password" });
    expect(m.app.state.authed).toBe(false);
  });

  it("says the server can't be reached for any other failure", async () => {
    const m = await mountApp({ signedIn: false });
    fail("POST /auth/login", 500, "boom");

    expect(await act2(() => m.app.signIn("a@b.edu", "x"))).toEqual({ ok: false, error: "Couldn't reach the server. Please try again." });
  });
});

describe("signOut and an expired session", () => {
  it("ends the session, clears what the person could see and goes to the sign-in page", async () => {
    const m = await mountApp({ events: [stored(1)] });

    await act2(() => m.app.signOut());

    expect(m.app.state).toMatchObject({ authed: false, user: null, events: [], signInNotice: null });
    expect(called("POST /auth/logout")).toBe(1);
    expect(router.push).toHaveBeenCalledWith("/login");
  });

  it("signs out even when the server can't be told", async () => {
    const m = await mountApp();
    fail("POST /auth/logout", 500);

    await act2(() => m.app.signOut());

    expect(m.app.state.authed).toBe(false);
  });

  it("explains an expired session on the sign-in page when any call is refused with 401", async () => {
    const m = await mountApp();

    await act2(() => m.app.handleApiError(new ApiError(401, "expired")));

    expect(m.app.state).toMatchObject({ authed: false, signInNotice: "Your session has expired. Please sign in again." });
    expect(router.push).toHaveBeenCalledWith("/login");
  });
});

describe("handleApiError", () => {
  it("tells the person they lack permission on a 403", async () => {
    const m = await mountApp();

    await act2(() => m.app.handleApiError(new ApiError(403, "no")));

    expect(m.app.state).toMatchObject({ toast: "You don't have permission to do that.", toastKind: "bad", authed: true });
  });

  it("shows the message of any other error, or a general one for something that isn't an error", async () => {
    const m = await mountApp();

    await act2(() => m.app.handleApiError(new Error("Disk full")));
    expect(m.app.state).toMatchObject({ toast: "Disk full", toastKind: "bad" });

    await act2(() => m.app.handleApiError("weird"));
    expect(m.app.state.toast).toBe("Something went wrong.");

    await act2(() => m.app.handleApiError(new ApiError(500, "Server error")));
    expect(m.app.state.toast).toBe("Server error");
  });
});

describe("the toast", () => {
  it("shows a message with its kind and clears it after a few seconds", async () => {
    const m = await mountApp();
    vi.useFakeTimers();

    await act2(() => m.app.flash("Saved."));
    expect(m.app.state).toMatchObject({ toast: "Saved.", toastKind: "ok" });

    await act2(() => m.app.flash("Careful", "warn"));
    await act2(() => vi.advanceTimersByTime(3000));
    expect(m.app.state.toast).toBe("Careful"); // the first message's timer was replaced

    await act2(() => vi.advanceTimersByTime(500));
    expect(m.app.state.toast).toBeNull();
  });
});

describe("idle sign-out", () => {
  it("is watching only while someone is signed in", async () => {
    const out = await mountApp({ signedIn: false });
    expect(idle.active).toBe(false);

    const m = await mountApp();
    expect(idle.active).toBe(true);
    expect(out.app.state.authed).toBe(false);
  });

  it("signs out on this browser only, explains why, and goes to the sign-in page", async () => {
    const m = await mountApp();

    await act2(() => idle.onIdle());

    expect(called("POST /auth/logout?all_sessions=false")).toBe(1);
    expect(m.app.state.authed).toBe(false);
    expect(m.app.state.signInNotice).toMatch(/signed out after \d+ minutes of inactivity/);
    expect(router.push).toHaveBeenCalledWith("/login");
  });

  it("still signs out when the server can't be told", async () => {
    const m = await mountApp();
    fail("POST /auth/logout?all_sessions=false", 500);

    await act2(() => idle.onIdle());

    expect(m.app.state.authed).toBe(false);
  });

  it("ends the session when the keep-alive ping is refused, and ignores other ping failures", async () => {
    const m = await mountApp();

    await act2(() => idle.onKeepAliveError(new Error("offline")));
    expect(m.app.state.authed).toBe(true);

    await act2(() => idle.onKeepAliveError(new ApiError(401, "expired")));
    expect(m.app.state.authed).toBe(false);
  });
});

describe("data loaded after sign-in", () => {
  it("loads the full venue catalogue (inactive included) for coordinators and venue staff, and the plain one for others", async () => {
    route("GET /venues?include_inactive=true", []);
    await mountApp({ role: "coordinator" });
    expect(called("GET /venues?include_inactive=true")).toBe(1);

    resetApi();
    await mountApp({ role: "attendee" });
    expect(called("GET /venues")).toBe(1);
    expect(called("GET /venues?include_inactive=true")).toBe(0);
  });

  it("leaves the venue list empty when the catalogue can't be loaded", async () => {
    const m = await mountApp({ routes: {} });
    fail("GET /venues?include_inactive=true", 500);

    const again = await mountApp({ routes: { "GET /venues?include_inactive=true": () => { throw new ApiError(500, "down"); } } });

    expect(m.app.state.venues).toEqual([]);
    expect(again.app.state.venues).toEqual([]);
  });

  it("lists the events the person may see", async () => {
    const m = await mountApp({ events: [stored(1), stored(2, { name: "Gala" })] });

    expect(m.app.state.events.map((e) => e.id)).toEqual(["EVT-1", "EVT-2"]);
    expect(m.app.event("EVT-2")?.name).toBe("Gala");
    expect(m.app.event("nope")).toBeUndefined();
    expect(m.app.venue("9")).toBeUndefined();
    expect(m.app.equipName("E1")).toBeTruthy();
    expect(m.app.freeQty("E1")).toBeGreaterThanOrEqual(0);
    expect(m.app.reservedQty("E1")).toBe(0);
  });

  it("shows the error when the events can't be loaded, and loads them again on request", async () => {
    const m = await mountApp({ routes: { "GET /events": () => { throw new ApiError(500, "Events are unavailable"); } } });
    expect(m.app.state.toast).toBe("Events are unavailable");

    route("GET /events", [stored(3)]);
    await act2(() => m.app.reloadEvents());

    expect(m.app.state.events.map((e) => e.id)).toEqual(["EVT-3"]);
  });

  it("attaches saved booking requests to a coordinator's events", async () => {
    const booking = { id: 5, event_id: 1, event_name: "Event 1", venue_id: 2, venue_name: "Grand Hall", status: "pending" } as never;

    const m = await mountApp({ role: "coordinator", events: [stored(1)], bookings: [booking] });

    expect(m.app.state.events[0].bookings?.map((b) => b.id)).toEqual([5]);
    expect(m.app.state.expiredHolds).toEqual([]);
  });

  it("gives venue staff the holds that lapsed, whose events they no longer see", async () => {
    const lapsed = { id: 6, event_id: 9, event_name: "Gone", venue_id: 2, venue_name: "Grand Hall", status: "expired" } as never;

    const m = await mountApp({ role: "venue", bookings: [lapsed] });

    expect(m.app.state.expiredHolds.map((b) => b.id)).toEqual([6]);
  });

  it("does not ask other roles for bookings", async () => {
    await mountApp({ role: "organiser", events: [stored(1)] });

    expect(called("GET /bookings")).toBe(0);
  });

  it("loads the attendee's own registrations", async () => {
    const row = { id: 4, eventId: 1, eventName: "Event 1", eventDate: "2026-11-26", eventStart: "18:30:00", eventEnd: "21:00:00",
      attendeeName: "Sam", attendeeEmail: PEOPLE.attendee.email, status: "registered", registeredAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" };

    const m = await mountApp({ role: "attendee", events: [stored(1)], routes: { "GET /registrations/me": [row] } });

    expect(m.app.state.registrations).toHaveLength(1);
  });

  it("shows the error when the attendee's registrations can't be loaded", async () => {
    const m = await mountApp({ role: "attendee", routes: { "GET /registrations/me": () => { throw new ApiError(500, "Registrations are down"); } } });

    expect(m.app.state.toast).toBe("Registrations are down");
  });

  it("loads the coordinator accounts for the lead, and an empty list when that fails", async () => {
    const coordinators = [{ id: 7, name: "Priya Tan" }];
    const lead = await mountApp({ role: "lead", routes: { "GET /coordinators": coordinators } });
    expect(lead.app.state.coordinators).toEqual(coordinators);

    const failed = await mountApp({ role: "lead", routes: { "GET /coordinators": () => { throw new ApiError(500, "x"); } } });
    expect(failed.app.state.coordinators).toEqual([]);
  });

  it("loads the safety checks for the safety officer, and shows the error when that fails", async () => {
    const checks = [{ eventId: 1, name: "Event 1" }];
    const officer = await mountApp({ role: "safety", routes: { "GET /safety-checks": checks } });
    expect(officer.app.state.safetyChecks).toEqual(checks);

    const failed = await mountApp({ role: "safety", routes: { "GET /safety-checks": () => { throw new ApiError(500, "Checks are down"); } } });
    expect(failed.app.state.toast).toBe("Checks are down");
  });
});

describe("selecting and filtering events", () => {
  it("selects an event on a tab, with the request tab by default", async () => {
    const m = await mountApp();

    await act2(() => m.app.select("EVT-1"));
    expect(m.app.state).toMatchObject({ selectedId: "EVT-1", tab: "request" });

    await act2(() => m.app.select("EVT-2", "venue"));
    expect(m.app.state).toMatchObject({ selectedId: "EVT-2", tab: "venue" });
  });

  it("opens an event in the queue", async () => {
    const m = await mountApp();

    await act2(() => m.app.selectAndGoToQueue("EVT-4"));

    expect(m.app.state.selectedId).toBe("EVT-4");
    expect(router.push).toHaveBeenCalledWith("/queue");
  });

  it("changes the tab, the queue filter and the search text", async () => {
    const m = await mountApp();

    await act2(() => m.app.setTab("equipment"));
    await act2(() => m.app.setQueueFilter("all"));
    await act2(() => m.app.setSearch("gala"));

    expect(m.app.state).toMatchObject({ tab: "equipment", queueFilter: "all", search: "gala" });
  });

  it("changes the venue filter", async () => {
    const m = await mountApp();

    await act2(() => m.app.setVfCap("300"));
    await act2(() => m.app.setVfLayout("theatre"));

    expect(m.app.state.vf).toEqual({ cap: "300", layout: "theatre" });
  });
});

describe("notifications", () => {
  const rows = [
    { id: 11, eventId: 1, eventName: "Event 1", title: "Approved", body: "It was approved", createdAt: "2026-10-08T09:23:00Z", read: false },
    { id: 10, eventId: 2, eventName: "Event 2", title: "Reviewed", body: "Under review", createdAt: "2026-10-07T09:23:00Z", read: true },
  ];

  it("shows the saved notifications with negative ids and refreshes them every 15 seconds", async () => {
    const intervals = vi.spyOn(globalThis, "setInterval");
    const m = await mountApp({ routes: { "GET /notifications": rows } });
    expect(m.app.state.notifs.map((n) => n.id)).toEqual([-11, -10]);
    expect(m.app.state.olderNotifs).toBe(false);

    const poll = intervals.mock.calls.find(([, ms]) => ms === 15000)?.[0] as () => void;
    route("GET /notifications", [{ ...rows[0], read: true }]);
    await act2(() => poll());
    await flush();

    expect(called("GET /notifications")).toBe(2);
    expect(m.app.state.notifs.find((n) => n.id === -11)?.read).toBe(true);
    intervals.mockRestore();
  });

  it("ignores a refresh that arrives after the person left the page", async () => {
    const intervals = vi.spyOn(globalThis, "setInterval");
    const m = await mountApp({ routes: { "GET /notifications": rows } });
    const poll = intervals.mock.calls.find(([, ms]) => ms === 15000)?.[0] as () => void;
    intervals.mockRestore();
    route("GET /notifications", [{ ...rows[0], title: "Too late" }]);

    m.hook.unmount();
    poll();
    await flush();

    expect(called("GET /notifications")).toBe(2);
    expect(m.app.state.notifs.map((n) => n.title)).toEqual(["Approved", "Reviewed"]);
  });

  it("marks only the signed-in role's notifications read", async () => {
    const m = await mountApp({
      role: "lead",
      events: [stored(1, { id: undefined as never })],
      routes: { "GET /coordinators": [{ id: 7, name: "Priya Tan" }], "GET /notifications": [{ ...rows[0], id: 3 }] },
    });
    await act2(() => m.app.assignCoordinator("EVT-undefined", "Priya Tan")); // adds notices for other roles, on the page only
    await flush();

    await act2(() => m.app.markAllRead());

    const byRole = Object.fromEntries(m.app.state.notifs.map((n) => [n.to + n.id, n.read]));
    expect(Object.values(byRole).filter(Boolean)).toHaveLength(1); // the lead's own saved notice
    expect(m.app.state.notifs.filter((n) => n.to !== "lead").every((n) => !n.read)).toBe(true);
  });

  it("keeps working when a refresh fails", async () => {
    const m = await mountApp({ routes: { "GET /notifications": () => { throw new ApiError(500, "x"); } } });

    expect(m.app.state.notifs).toEqual([]);
  });

  it("opens and closes the panel", async () => {
    const m = await mountApp();

    await act2(() => m.app.toggleNotifs());
    expect(m.app.state.notifsOpen).toBe(true);
    await act2(() => m.app.toggleNotifs());
    expect(m.app.state.notifsOpen).toBe(false);
  });

  it("marks every notification read on the server and on the page", async () => {
    const m = await mountApp({ routes: { "GET /notifications": rows } });

    await act2(() => m.app.markAllRead());

    expect(called("POST /notifications/read")).toBe(1);
    expect(m.app.state.notifs.every((n) => n.read)).toBe(true);
  });

  it("shows the error when marking all read fails, and leaves them unread", async () => {
    const m = await mountApp({ routes: { "GET /notifications": rows } });
    fail("POST /notifications/read", 500, "Could not mark read");

    await act2(() => m.app.markAllRead());

    expect(m.app.state.toast).toBe("Could not mark read");
    expect(m.app.state.notifs[0].read).toBe(false);
  });

  it("marks one saved notification read on the server too", async () => {
    const m = await mountApp({ routes: { "GET /notifications": rows } });
    route("POST /notifications/11/read", undefined);

    await act2(() => m.app.markRead(-11));

    expect(called("POST /notifications/11/read")).toBe(1);
    expect(m.app.state.notifs.find((n) => n.id === -11)?.read).toBe(true);
  });

  it("marks a notification that exists only on the page without calling the server", async () => {
    const m = await mountApp();

    await act2(() => m.app.markRead(123));

    expect(apiFetch_calls("POST")).toBe(0);
  });

  it("shows the error when marking one read fails", async () => {
    const m = await mountApp({ routes: { "GET /notifications": rows } });
    fail("POST /notifications/11/read", 500, "Nope");

    await act2(() => m.app.markRead(-11));

    expect(m.app.state.toast).toBe("Nope");
  });

  it("does nothing for a notification it doesn't have, or one that isn't about a saved event", async () => {
    const aboutNothing = { ...rows[0], eventId: undefined };
    const m = await mountApp({ routes: { "GET /notifications": [aboutNothing] } });

    await act2(() => m.app.openNotification(999));
    await act2(() => m.app.openNotification(-11));

    expect(router.push).not.toHaveBeenCalled();
  });

  it("takes an organiser to their event and marks the notification read", async () => {
    const m = await mountApp({ role: "organiser", routes: { "GET /notifications": rows } });
    route("POST /notifications/11/read", undefined);
    await act2(() => m.app.toggleNotifs());

    await act2(() => m.app.openNotification(-11));

    expect(router.push).toHaveBeenCalledWith("/my-events/1");
    expect(m.app.state.notifsOpen).toBe(false);
    expect(called("POST /notifications/11/read")).toBe(1);
  });

  it("selects the event in the coordinator's unfiltered queue, and doesn't re-mark a read notification", async () => {
    const m = await mountApp({ role: "coordinator", events: [stored(2)], routes: { "GET /notifications": rows } });

    await act2(() => m.app.openNotification(-10));

    expect(router.push).toHaveBeenCalledWith("/queue");
    expect(m.app.state).toMatchObject({ selectedId: "EVT-2", tab: "request", queueFilter: "all", search: "" });
    expect(called("POST /notifications/10/read")).toBe(0);
  });

  it("takes other roles to the page their role works on", async () => {
    const m = await mountApp({ role: "venue", routes: { "GET /notifications": [rows[1]] } });

    await act2(() => m.app.openNotification(-10));

    expect(router.push).toHaveBeenCalledWith("/bookings");
    expect(m.app.state.selectedId).toBe("");
  });

  it("loads the next older page below the ones already shown, and says whether there are still older ones", async () => {
    const m = await mountApp({ routes: { "GET /notifications": rows } });
    route("GET /notifications?before=10", [{ ...rows[1], id: 9, title: "Older" }]);

    await act2(() => m.app.loadOlderNotifs());

    expect(m.app.state.notifs.map((n) => n.id)).toEqual([-11, -10, -9]);
    expect(m.app.state.olderNotifs).toBe(false);
  });

  it("has nothing older to load when no saved notifications are shown", async () => {
    const m = await mountApp();

    await act2(() => m.app.loadOlderNotifs());

    expect(called("GET /notifications")).toBe(1);
  });

  it("shows the error when older notifications can't be loaded", async () => {
    const m = await mountApp({ routes: { "GET /notifications": rows } });
    fail("GET /notifications?before=10", 500, "No older ones");

    await act2(() => m.app.loadOlderNotifs());

    expect(m.app.state.toast).toBe("No older ones");
  });
});

describe("useApp", () => {
  it("can't be used outside the provider", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => renderHook(() => useApp())).toThrow("useApp() must be used within <AppProvider>");

    quiet.mockRestore();
  });
});

describe("loaders that hand the server's answer straight back", () => {
  it("loadEvent, loadConfirmation, loadAssignmentHistory and loadRegistrations", async () => {
    const m = await mountApp({ role: "coordinator" });
    route("GET /events/4", stored(4));
    route("GET /events/4/confirmation", { ready: true });
    route("GET /events/4/assignments", [{ id: 1 }]);
    route("GET /events/4/registrations", [{ id: 2, eventId: 4, eventName: "Event 4", eventDate: null, eventStart: null, eventEnd: null,
      attendeeName: "Sam", attendeeEmail: "sam@x.edu", status: "registered", registeredAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z" }]);

    expect((await act2(() => m.app.loadEvent(4))).id).toBe(4);
    expect(await act2(() => m.app.loadConfirmation(4))).toEqual({ ready: true });
    expect(await act2(() => m.app.loadAssignmentHistory(4))).toEqual([{ id: 1 }]);
    expect(await act2(() => m.app.loadRegistrations(4))).toHaveLength(1);
  });
});

function apiFetch_calls(method: string) {
  return bodies(`${method} /notifications/123/read`).length;
}


