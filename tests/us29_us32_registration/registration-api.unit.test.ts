/**
 * US29-US32 with registrations saved on the server: the browser's quick rule checks agree
 * with the server on dates, stored registrations are turned into the pages' shape, and
 * events carry the saved places-taken count and withdrawal deadline.
 */
import { describe, expect, it } from "vitest";
import { decideRegistration, registrationFromApi, withdrawalError, type StoredRegistration } from "../../lib/registration";
import { eventFromApi, type StoredEvent } from "../../lib/events/request/api";
import { detailSections } from "../../lib/events/details";
import type { EventRecord, RegistrationRecord } from "../../lib/types";

const event = (overrides: Partial<EventRecord> = {}): EventRecord => ({
  id: "EVT-7", backendId: 7, name: "Robotics Showcase", organiser: "Maya Rahman", status: "confirmed", date: "15 Dec 2026",
  day: null, start: "10:00", end: "16:00", pax: 80, purpose: "Demo", layout: "theatre", facilities: [], access: [],
  coordinator: "Priya Tan", venue: null, bookingState: null, equip: [], equipState: null, reg: true, regCap: 2,
  registered: 0, regClose: "2026-12-10", withdrawalClose: "2026-12-03", submittedAgo: "", activity: [], ...overrides,
});

const active: RegistrationRecord = {
  id: "REG-1", eventId: "EVT-7", attendeeName: "Sam Adeyemi", attendeeEmail: "sam.adeyemi@student.connectsphere.edu",
  status: "registered", registeredAt: "2026-11-01T02:00:00Z", updatedAt: "2026-11-01T02:00:00Z",
};

const at = (localDateTime: string) => new Date(localDateTime).getTime();

describe("closing dates count the whole day, as on the server", () => {
  it("still takes registrations on the closing date itself", () => {
    expect(decideRegistration(event(), undefined, at("2026-12-10T23:00:00"))).toEqual({ ok: true, status: "registered" });
  });

  it("refuses registrations the day after closing", () => {
    expect(decideRegistration(event(), undefined, at("2026-12-11T00:01:00")).ok).toBe(false);
  });

  it("allows withdrawal on the last day to withdraw, not the day after", () => {
    expect(withdrawalError(event(), active, at("2026-12-03T22:00:00"))).toBeNull();
    expect(withdrawalError(event(), active, at("2026-12-04T09:00:00"))).toBe(
      "The withdrawal deadline for Robotics Showcase has passed.",
    );
  });

  it("allows withdrawal at any time when there is no deadline", () => {
    expect(withdrawalError(event({ withdrawalClose: undefined }), active, at("2027-01-01T00:00:00"))).toBeNull();
  });
});

describe("capacity", () => {
  it("waitlists once every place is taken", () => {
    expect(decideRegistration(event({ registered: 2 }), undefined, at("2026-11-01T00:00:00"))).toEqual({ ok: true, status: "waitlisted" });
  });

  it("never waitlists an event without a capacity limit", () => {
    expect(decideRegistration(event({ regCap: 0, registered: 500 }), undefined, at("2026-11-01T00:00:00"))).toEqual({
      ok: true,
      status: "registered",
    });
  });
});

describe("registrationFromApi", () => {
  const stored: StoredRegistration = {
    id: 12, eventId: 7, eventName: "Robotics Showcase", eventDate: "2026-12-15", eventStart: "10:00:00", eventEnd: "16:00:00",
    attendeeName: "Sam Adeyemi", attendeeEmail: "sam.adeyemi@student.connectsphere.edu", status: "waitlisted",
    registeredAt: "2026-11-01T02:00:00Z", updatedAt: "2026-11-02T02:00:00Z",
  };

  it("links the registration to the event's frontend id and keeps its saved status", () => {
    expect(registrationFromApi(stored)).toEqual({
      id: "REG-12",
      eventId: "EVT-7",
      eventName: "Robotics Showcase",
      eventDate: "15 Dec 2026",
      eventStart: "10:00",
      eventEnd: "16:00",
      attendeeName: "Sam Adeyemi",
      attendeeEmail: "sam.adeyemi@student.connectsphere.edu",
      status: "waitlisted",
      registeredAt: "2026-11-01T02:00:00Z",
      updatedAt: "2026-11-02T02:00:00Z",
    });
  });

  it("copes with an event that has no date or times yet", () => {
    const r = registrationFromApi({ ...stored, eventDate: null, eventStart: null, eventEnd: null });

    expect([r.eventDate, r.eventStart, r.eventEnd]).toEqual([undefined, undefined, undefined]);
  });
});

describe("events carry the saved places-taken count and withdrawal deadline", () => {
  const stored = {
    id: 7, status: "confirmed", name: "Robotics Showcase", organiser: "Maya Rahman", updatedAt: "2026-11-01T02:00:00Z",
    reg: true, regCap: 120, regClose: "2026-12-10", registered: 37, withdrawalClose: "2026-12-03",
  } as StoredEvent;

  it("uses the server's count instead of starting at 0", () => {
    const e = eventFromApi(stored);

    expect(e.registered).toBe(37);
    expect(e.withdrawalClose).toBe("2026-12-03");
  });

  it("shows places taken and the withdrawal deadline in the event's details", () => {
    const rows = Object.fromEntries(
      detailSections(stored).flatMap((s) => s.rows.map((r) => [r.label, r.value])),
    );

    expect(rows["Places taken"]).toBe("37 of 120");
    expect(rows["Withdraw by"]).toBe("03 Dec 2026");
  });

  it("leaves both out for a role that wasn't sent them", () => {
    const { registered, withdrawalClose, ...techView } = stored;
    void registered;
    void withdrawalClose;

    const labels = detailSections(techView as StoredEvent).flatMap((s) => s.rows.map((r) => r.label));

    expect(labels).not.toContain("Places taken");
    expect(labels).not.toContain("Withdraw by");
  });
});
