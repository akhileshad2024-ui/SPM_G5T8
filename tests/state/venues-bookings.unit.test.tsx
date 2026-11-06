// @vitest-environment jsdom
/**
 * lib/state/app-context.tsx: the venue catalogue (create, edit, activate), requesting a venue,
 * Venue Staff approving or rejecting a booking, hold expiry, changing and cancelling bookings.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoredEvent } from "../../lib/events/request/api";
import type { ApiVenue, VenueBookingRecord } from "../../lib/types";
import { resetNext } from "../helpers/next-mocks";
import { act2, bodies, called, fail, flush, mountApp, resetApi, route, stored } from "./harness";

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

function apiVenue(id: number, overrides: Partial<ApiVenue> = {}): ApiVenue {
  return {
    id, name: "Grand Hall", location: "Level 1", cap: 300, layouts: ["banquet", "theatre"], facilities: [], accessibility: [],
    operatingHours: null, operatingDays: [], unavailability: [], setupMinutes: 30, turnaroundMinutes: 15,
    is_active: true, last_updated_by: "Daniel Ortiz", last_updated_at: "2026-10-01T00:00:00Z", ...overrides,
  };
}

function booking(id: number, overrides: Partial<VenueBookingRecord> = {}): VenueBookingRecord {
  return {
    id, event_id: 1, event_name: "Event 1", venue_id: 3, venue_name: "Grand Hall", date: "2026-11-26", start: "18:30", end: "21:00",
    setup_minutes: 30, teardown_minutes: 15, hold_start: "2026-11-26T18:00:00", hold_end: "2026-11-26T21:15:00", attendance: 95,
    layout: "banquet", purpose: null, status: "pending", verdict: "suitable", requested_by: "Priya Tan", requested_at: "2026-10-01T00:00:00Z",
    override: null, decided_by: null, decided_at: null, decision_reason: null, flag: null, reassessment: null,
    ...overrides,
  } as VenueBookingRecord;
}

const approved = (id = 1, overrides: Partial<StoredEvent> = {}) => stored(id, { status: "approved", coordinator: "Priya Tan", ...overrides });
const unstored = (overrides: Partial<StoredEvent> = {}) => stored(1, { id: undefined as unknown as number, ...overrides });
const withVenue = (events: StoredEvent[] = [approved()]) =>
  mountApp({ events, routes: { "GET /venues?include_inactive=true": [apiVenue(3)] } });

describe("the venue catalogue", () => {
  it("reloads the catalogue, and shows the error when that fails", async () => {
    const m = await mountApp();
    route("GET /venues?include_inactive=true", [apiVenue(3), apiVenue(4, { name: "Annex" })]);

    await act2(() => m.app.reloadVenues());
    expect(m.app.state.venues.map((v) => v.id)).toEqual(["3", "4"]);

    fail("GET /venues?include_inactive=true", 500, "Catalogue unavailable");
    await act2(() => m.app.reloadVenues());
    expect(m.app.state.toast).toBe("Catalogue unavailable");
  });

  it("adds a new venue to the catalogue", async () => {
    const m = await mountApp();
    route("POST /venues", apiVenue(5, { name: "Courtyard" }));

    const result = await act2(() => m.app.saveVenue(null, { name: "Courtyard" }));

    expect(result).toMatchObject({ ok: true, venue: { id: "5", name: "Courtyard" }, flagged: [] });
    expect(m.app.state.venues.map((v) => v.name)).toEqual(["Courtyard"]);
    expect(bodies("POST /venues")).toEqual([{ name: "Courtyard" }]);
  });

  it("replaces an edited venue in the catalogue", async () => {
    const m = await withVenue();
    route("PUT /venues/3", apiVenue(3, { name: "Grand Hall (renamed)" }));

    const result = await act2(() => m.app.saveVenue("3", { name: "Grand Hall (renamed)" }));

    expect(result.ok).toBe(true);
    expect(m.app.state.venues.map((v) => v.name)).toEqual(["Grand Hall (renamed)"]);
  });

  it("leaves the other venues as they were when one is edited", async () => {
    const m = await mountApp({ routes: { "GET /venues?include_inactive=true": [apiVenue(3), apiVenue(4, { name: "Annex" })] } });
    route("PUT /venues/3", apiVenue(3, { name: "Renamed" }));

    await act2(() => m.app.saveVenue("3", { name: "Renamed" }));

    expect(m.app.state.venues.map((v) => v.name)).toEqual(["Renamed", "Annex"]);
  });

  it("keeps the bookings the server flagged on their events and lists those events as affected", async () => {
    const held = approved(1, { venue: 3, bookingState: "approved" });
    const m = await withVenue([held]);
    const flagged = booking(5, { status: "approved", flag: { reason: "maintenance" } as never });
    route("GET /bookings", [booking(5, { status: "approved" })]);
    await act2(() => m.app.reloadEvents());
    route("PUT /venues/3", apiVenue(3, { flagged_bookings: [flagged] }));

    const result = await act2(() => m.app.saveVenue("3", { is_active: true }));

    expect(result.ok && result.flagged.map((e) => e.id)).toEqual(["EVT-1"]);
    expect(m.app.state.events[0].bookings?.[0].flag).toBeTruthy();
  });

  it("flags, on the page, a booking that a venue change has put in trouble, and adds it to the event's activity", async () => {
    const held = approved(1, { venue: 3, bookingState: "approved" });
    const m = await withVenue([held]);
    route("PUT /venues/3", apiVenue(3, { is_active: false }));

    const result = await act2(() => m.app.saveVenue("3", { is_active: false }));

    expect(result.ok && result.flagged.map((e) => e.id)).toEqual(["EVT-1"]);
    expect(m.app.state.events[0].activity[0].title).toBe("Venue issue — alternative arrangements needed");
  });

  it("lists an event once when both the server and the page flagged it", async () => {
    const held = approved(1, { venue: 3, bookingState: "approved" });
    const m = await withVenue([held]);
    route("PUT /venues/3", apiVenue(3, { is_active: false, reassessed_bookings: [booking(5)] }));

    const result = await act2(() => m.app.saveVenue("3", { is_active: false }));

    expect(result.ok && result.flagged).toHaveLength(1);
  });

  it("returns the field errors when the server rejects the venue (422)", async () => {
    const m = await mountApp();
    fail("POST /venues", 422, "cap: must be greater than 0", { cap: "must be greater than 0" });

    const result = await act2(() => m.app.saveVenue(null, { name: "X" }));

    expect(result).toEqual({ ok: false, error: "cap: must be greater than 0", fields: { cap: "must be greater than 0" } });
    expect(m.app.state.toast).toBeNull();
  });

  it("shows any other failure and returns its message", async () => {
    const m = await mountApp();
    fail("POST /venues", 500, "Database is down");

    const result = await act2(() => m.app.saveVenue(null, { name: "X" }));

    expect(result).toEqual({ ok: false, error: "Database is down", fields: {} });
    expect(m.app.state.toast).toBe("Database is down");
  });

  it("returns a general message for a failure that isn't an error", async () => {
    const m = await mountApp({ routes: { "POST /venues": () => { throw "boom"; } } });

    expect(await act2(() => m.app.saveVenue(null, { name: "X" }))).toEqual({ ok: false, error: "Something went wrong.", fields: {} });
  });

  it("deactivates and reactivates a venue through the same save", async () => {
    const m = await withVenue();
    route("PUT /venues/3", apiVenue(3, { is_active: false }));

    await act2(() => m.app.setVenueActive("3", false));

    expect(bodies("PUT /venues/3")).toEqual([{ is_active: false }]);
    expect(m.app.state.venues[0].isActive).toBe(false);
  });
});

describe("requestBooking", () => {
  const response = (overrides: Partial<VenueBookingRecord> = {}) => ({
    booking: booking(5, overrides),
    notification: { to: "venue", title: "t", body: "b" },
  });
  const arrange = () => {
    route("GET /events/1", approved(1, { venue: 3, bookingState: "pending" }));
    route("GET /bookings", [booking(5)]);
  };

  it("returns false for an event or a venue it doesn't have", async () => {
    const m = await withVenue();

    expect(await act2(() => m.app.requestBooking("EVT-9", "3"))).toBe(false);
    expect(await act2(() => m.app.requestBooking("EVT-1", "99"))).toBe(false);
  });

  it("refuses an event that isn't approved, without calling the server", async () => {
    const m = await withVenue([stored(1, { status: "submitted" })]);

    expect(await act2(() => m.app.requestBooking("EVT-1", "3"))).toBe(false);
    expect(m.app.state).toMatchObject({ toast: "A venue can only be requested for an approved event.", toastKind: "warn" });
    expect(called("POST /venues/3/booking-requests")).toBe(0);
  });

  it("requests the venue, records it in the activity and re-reads the event's bookings", async () => {
    const m = await withVenue();
    route("POST /venues/3/booking-requests", response());
    arrange();

    expect(await act2(() => m.app.requestBooking("EVT-1", "3"))).toBe(true);

    expect(bodies("POST /venues/3/booking-requests")).toEqual([{ event_id: 1, acknowledged: false }]);
    expect(m.app.state.toast).toBe("Booking requested at Grand Hall.");
    expect(m.app.state.events[0]).toMatchObject({ venue: "3", bookingState: "pending" });
    expect(m.app.state.events[0].bookings?.map((b) => b.id)).toEqual([5]);
    expect(m.app.state.events[0].activity[0].body).toContain("30 min setup and 15 min teardown");
  });

  it("re-reads the bookings without touching the event's neighbours", async () => {
    const m = await mountApp({ events: [approved(1), stored(2, { name: "Other" })], routes: { "GET /venues?include_inactive=true": [apiVenue(3)] } });
    route("POST /venues/3/booking-requests", response());
    arrange();

    await act2(() => m.app.requestBooking("EVT-1", "3"));

    expect(m.app.state.events.map((e) => e.bookingState)).toEqual(["pending", null]);
  });

  it("describes a booking with its own purpose, attendance and layout, and one that replaces another", async () => {
    const m = await withVenue([approved(1, { bookingState: "approved", venue: 3 })]);
    route("POST /venues/3/booking-requests", response({ purpose: "Breakout", attendance: 40, layout: "theatre", replaces_booking_id: 2 } as never));
    arrange();

    const ok = await act2(() => m.app.requestBooking("EVT-1", "3", true, { attendance: 40, layout: "theatre", purpose: " Breakout ", replaces: 2 }));

    expect(ok).toBe(true);
    expect(bodies("POST /venues/3/booking-requests")).toEqual([
      { event_id: 1, acknowledged: true, attendance: 40, layout: "theatre", purpose: "Breakout", replaces_booking_id: 2 },
    ]);
    const body = m.app.state.events[0].activity[0].body;
    expect(body).toContain("For: Breakout.");
    expect(body).toContain("40 people, theatre layout.");
    expect(body).toContain("Replaces a booking");
    expect(m.app.state.toast).toBe("Replacement requested at Grand Hall. Venue Staff will review it.");
  });

  it("records an acknowledged override", async () => {
    const m = await withVenue();
    const override = { acknowledged_by: "Priya Tan", verdict: "partially_suitable", unmet: [{ reason: "No stage." }, { reason: "No ramp." }] };
    route("POST /venues/3/booking-requests", response({ override } as never));
    arrange();

    await act2(() => m.app.requestBooking("EVT-1", "3", true));

    expect(m.app.state.events[0].activity.map((a) => a.title)).toContain("Venue override acknowledged");
    expect(m.app.state.events[0].activity[0].body).toBe("Priya Tan went ahead with Grand Hall, which is partially suitable: No stage. No ramp.");
  });

  it("returns false and shows the error when the server refuses", async () => {
    const m = await withVenue();
    fail("POST /venues/3/booking-requests", 409, "Venue is held at that time");

    expect(await act2(() => m.app.requestBooking("EVT-1", "3"))).toBe(false);
    expect(m.app.state.toast).toBe("Venue is held at that time");
  });

  it("treats an event Venue Staff can no longer read as having released its venue", async () => {
    const rejected = booking(5, { status: "rejected" });
    const m = await mountApp({
      events: [approved(1, { venue: 3, bookingState: "pending" })],
      bookings: [rejected],
      routes: { "GET /venues?include_inactive=true": [apiVenue(3)] },
    });
    route("POST /venues/3/booking-requests", response({ status: "rejected" }));
    fail("GET /events/1", 403, "Not yours");

    expect(await act2(() => m.app.requestBooking("EVT-1", "3"))).toBe(true);

    expect(m.app.state.events[0]).toMatchObject({ venue: null, bookingState: "rejected" });
  });

  it("shows an event with no earlier bookings as having no venue when Venue Staff can't read it", async () => {
    const m = await withVenue();
    route("POST /venues/3/booking-requests", response({ status: "cancelled" }));
    fail("GET /events/1", 403, "Not yours");

    expect(await act2(() => m.app.requestBooking("EVT-1", "3"))).toBe(true);

    expect(m.app.state.events[0]).toMatchObject({ venue: null, bookingState: null });
  });

  it("returns false when the event can't be re-read for another reason", async () => {
    const m = await withVenue();
    route("POST /venues/3/booking-requests", response());
    fail("GET /events/1", 500, "Server error");

    expect(await act2(() => m.app.requestBooking("EVT-1", "3"))).toBe(false);
    expect(m.app.state.toast).toBe("Server error");
  });
});

describe("Venue Staff decide a booking", () => {
  const setup = () =>
    mountApp({ role: "venue", events: [approved(1, { venue: 3, bookingState: "pending" })], bookings: [booking(5)] });
  const readBack = () => {
    route("GET /events/1", approved(1, { venue: 3, bookingState: "approved" }));
    route("GET /bookings", [booking(5, { status: "approved" })]);
  };

  it("approves a pending booking and tells the page", async () => {
    const m = await setup();
    route("POST /bookings/5/decision", booking(5, { status: "approved" }));
    readBack();

    await act2(() => m.app.approveBooking("EVT-1", 5));
    await flush();

    expect(bodies("POST /bookings/5/decision")).toEqual([{ outcome: "approved", reason: "" }]);
    expect(m.app.state.toast).toBe("Grand Hall confirmed for Event 1. The coordinator will be notified.");
    expect(m.app.state.events[0].activity.map((a) => a.title)).toContain("Venue booking approved");
    expect(m.app.state.events[0].bookingState).toBe("approved");
  });

  it("does nothing for an event it doesn't have", async () => {
    const m = await setup();

    await act2(() => m.app.approveBooking("EVT-9", 5));

    expect(called("POST /bookings/5/decision")).toBe(0);
  });

  it("rejects through the dialog with a reason, then closes it", async () => {
    const m = await setup();
    route("POST /bookings/5/decision", booking(5, { status: "rejected" }));
    readBack();
    await act2(() => m.app.openModal("rejectBooking", "EVT-1", 5));
    await act2(() => m.app.setModalText("Held for setup."));

    await act2(() => m.app.confirmModal());
    await flush();

    expect(bodies("POST /bookings/5/decision")).toEqual([{ outcome: "rejected", reason: "Held for setup." }]);
    expect(m.app.state).toMatchObject({ modal: null, toastKind: "bad" });
    expect(m.app.state.toast).toContain("Booking rejected. Grand Hall has been released");
    expect(m.app.state.events[0].activity[0].body).toBe("Grand Hall: Held for setup.");
  });

  it("still succeeds when re-reading the bookings afterwards fails", async () => {
    const m = await setup();
    route("POST /bookings/5/decision", booking(5, { status: "approved" }));
    fail("GET /bookings", 500, "later");

    await act2(() => m.app.approveBooking("EVT-1", 5));
    await flush();

    expect(m.app.state.toast).toContain("confirmed for Event 1");
  });

  it("shows what is there now when the server refuses because of a clash (409), and keeps the dialog open", async () => {
    const m = await setup();
    fail("POST /bookings/5/decision", 409, "Clashes with another booking");
    readBack();
    await act2(() => m.app.openModal("rejectBooking", "EVT-1", 5));
    await act2(() => m.app.setModalText("x"));

    await act2(() => m.app.confirmModal());
    await flush();

    expect(m.app.state.toast).toBe("Clashes with another booking");
    expect(m.app.state.modal).not.toBeNull();
    expect(called("GET /events/1")).toBe(1);
  });

  it("still shows the refusal when re-reading afterwards fails too", async () => {
    const m = await setup();
    fail("POST /bookings/5/decision", 409, "Clashes with another booking");
    fail("GET /bookings", 500, "later");

    await act2(() => m.app.approveBooking("EVT-1", 5));
    await flush();

    expect(m.app.state.toast).toBe("Clashes with another booking");
  });

  it("shows any other failure without re-reading", async () => {
    const m = await setup();
    fail("POST /bookings/5/decision", 500, "Down");

    await act2(() => m.app.approveBooking("EVT-1", 5));
    await flush();

    expect(m.app.state.toast).toBe("Down");
    expect(called("GET /events/1")).toBe(0);
  });

  it("skips re-reading an event that was never stored", async () => {
    const m = await mountApp({ role: "venue", events: [unstored({ status: "approved" })] });
    route("POST /bookings/5/decision", booking(5, { status: "approved" }));

    await act2(() => m.app.approveBooking("EVT-undefined", 5));
    await flush();

    expect(m.app.state.toast).toContain("confirmed for Event 1");
  });
});

describe("setHoldExpiry", () => {
  const setup = () => mountApp({ role: "venue", events: [approved(1, { venue: 3, bookingState: "pending" })], bookings: [booking(5)] });

  it("returns false for an event it doesn't have", async () => {
    const m = await setup();

    expect(await act2(() => m.app.setHoldExpiry("EVT-9", 5, "2027-01-02T18:00"))).toBe(false);
  });

  it("asks for a date and time when the one given isn't valid", async () => {
    const m = await setup();

    expect(await act2(() => m.app.setHoldExpiry("EVT-1", 5, "soon"))).toBe(false);
    expect(m.app.state).toMatchObject({ toast: "Choose the date and time the hold should expire.", toastKind: "warn" });
  });

  it("saves the new expiry in campus time and re-reads the bookings", async () => {
    const m = await setup();
    route("POST /bookings/5/hold", booking(5));
    route("GET /events/1", approved(1, { venue: 3, bookingState: "pending" }));

    expect(await act2(() => m.app.setHoldExpiry("EVT-1", 5, "2027-01-02T18:00"))).toBe(true);

    expect(bodies("POST /bookings/5/hold")).toEqual([{ expires_at: "2027-01-02T18:00:00+08:00" }]);
    expect(m.app.state.toast).toBe("Grand Hall held for Event 1 until the new expiry.");
  });

  it("shows the server's reason when it refuses (409), and any other failure as an error", async () => {
    const m = await setup();
    fail("POST /bookings/5/hold", 409, "Setup has already started");
    expect(await act2(() => m.app.setHoldExpiry("EVT-1", 5, "2027-01-02T18:00"))).toBe(false);
    expect(m.app.state).toMatchObject({ toast: "Setup has already started", toastKind: "warn" });

    fail("POST /bookings/5/hold", 500, "Down");
    expect(await act2(() => m.app.setHoldExpiry("EVT-1", 5, "2027-01-02T18:00"))).toBe(false);
    expect(m.app.state).toMatchObject({ toast: "Down", toastKind: "bad" });
  });
});

describe("changeBooking", () => {
  const setup = () => mountApp({ events: [approved(1, { venue: 3, bookingState: "pending" })], bookings: [booking(5)] });
  const readBack = () => route("GET /events/1", approved(1, { venue: 3, bookingState: "pending" }));

  it("returns not-ok for an event it doesn't have", async () => {
    const m = await setup();

    expect(await act2(() => m.app.changeBooking("EVT-9", 5, {}))).toEqual({ ok: false });
  });

  it("saves the new needs, says what changed and re-reads the bookings", async () => {
    const m = await setup();
    route("PATCH /bookings/5", booking(5, { purpose: "Breakout", attendance: 40, layout: "theatre" }));
    readBack();

    expect(await act2(() => m.app.changeBooking("EVT-1", 5, { attendance: 40, layout: "theatre" }))).toEqual({ ok: true });

    expect(bodies("PATCH /bookings/5")).toEqual([{ attendance: 40, layout: "theatre", acknowledged: false }]);
    expect(m.app.state.events[0].activity[0].body).toContain("Grand Hall (Breakout): 40 people, theatre layout.");
    expect(m.app.state.toast).toBe("Grand Hall booking changed.");
  });

  it("describes a booking without a purpose, and sends an acknowledged warning", async () => {
    const m = await setup();
    route("PATCH /bookings/5", booking(5));
    readBack();

    await act2(() => m.app.changeBooking("EVT-1", 5, {}, true));

    expect(bodies("PATCH /bookings/5")).toEqual([{ acknowledged: true }]);
    expect(m.app.state.events[0].activity[0].body).toMatch(/^Grand Hall: 95 people/);
  });

  it("hands back the warning when the venue isn't fully suitable for the new needs", async () => {
    const m = await setup();
    fail("PATCH /bookings/5", 409, "Not fully suitable. Acknowledge the warning to continue.");

    expect(await act2(() => m.app.changeBooking("EVT-1", 5, { attendance: 900 }))).toEqual({
      ok: false, warning: "Not fully suitable. Acknowledge the warning to continue.",
    });
    expect(m.app.state.toast).toBeNull();
  });

  it("shows any other refusal as an error", async () => {
    const m = await setup();
    fail("PATCH /bookings/5", 409, "Booking was decided");

    expect(await act2(() => m.app.changeBooking("EVT-1", 5, {}))).toEqual({ ok: false });
    expect(m.app.state.toast).toBe("Booking was decided");
  });
});

describe("cancelling bookings", () => {
  const setup = (event: StoredEvent = approved(1, { venue: 3, bookingState: "pending" })) =>
    mountApp({ events: [event], bookings: [booking(5)] });
  const readBack = () => route("GET /events/1", approved(1));

  it("cancels one booking, naming its purpose when it has one", async () => {
    const m = await setup();
    route("POST /bookings/5/cancel", booking(5, { status: "cancelled", purpose: "Breakout" }));
    readBack();

    expect(await act2(() => m.app.cancelBooking("EVT-1", 5))).toBe(true);

    expect(m.app.state.toast).toBe("Grand Hall booking cancelled.");
    expect(m.app.state.events[0].activity[0].body).toBe("Grand Hall (Breakout).");
  });

  it("cancels a booking without a purpose", async () => {
    const m = await setup();
    route("POST /bookings/5/cancel", booking(5, { status: "cancelled" }));
    readBack();

    await act2(() => m.app.cancelBooking("EVT-1", 5));

    expect(m.app.state.events[0].activity[0].body).toBe("Grand Hall.");
  });

  it("returns false for an event it doesn't have, and when the server refuses", async () => {
    const m = await setup();

    expect(await act2(() => m.app.cancelBooking("EVT-9", 5))).toBe(false);

    fail("POST /bookings/5/cancel", 409, "Already cancelled");
    expect(await act2(() => m.app.cancelBooking("EVT-1", 5))).toBe(false);
    expect(m.app.state.toast).toBe("Already cancelled");
  });

  it("cancels all of an event's bookings and counts them", async () => {
    const m = await setup();
    route("POST /events/1/bookings/cancel", [booking(5), booking(6, { venue_name: "Annex" })]);
    readBack();

    expect(await act2(() => m.app.cancelAllBookings("EVT-1"))).toBe(true);
    expect(m.app.state.toast).toBe("2 bookings cancelled.");
    expect(m.app.state.events[0].activity[0].body).toBe("Grand Hall, Annex");

    route("POST /events/1/bookings/cancel", [booking(5)]);
    await act2(() => m.app.cancelAllBookings("EVT-1"));
    expect(m.app.state.toast).toBe("1 booking cancelled.");
  });

  it("returns false for an event it doesn't have or that was never stored, and when the server refuses", async () => {
    const m = await setup();
    expect(await act2(() => m.app.cancelAllBookings("EVT-9"))).toBe(false);

    const sample = await setup(unstored({ status: "approved" }));
    expect(await act2(() => sample.app.cancelAllBookings("EVT-undefined"))).toBe(false);

    fail("POST /events/1/bookings/cancel", 403, "no");
    expect(await act2(() => m.app.cancelAllBookings("EVT-1"))).toBe(false);
    expect(m.app.state.toast).toBe("You don't have permission to do that.");
  });
});
