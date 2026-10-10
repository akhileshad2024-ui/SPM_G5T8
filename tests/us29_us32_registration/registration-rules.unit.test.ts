import { describe, expect, it } from "vitest";
import { decideRegistration, withdrawalError } from "../../lib/registration";
import type { EventRecord, RegistrationRecord } from "../../lib/types";

const future = Date.parse("2026-06-01T00:00:00Z");
const event = (overrides: Partial<EventRecord> = {}): EventRecord => ({
  id: "EVT-TEST", name: "Test Event", organiser: "Maya Rahman", status: "confirmed", date: "01 Jun 2026", day: null,
  start: "10:00", end: "11:00", pax: 10, purpose: "Test", layout: "theatre", facilities: [], access: [], coordinator: "Priya Tan",
  venue: null, bookingState: null, equip: [], equipState: null, reg: true, regCap: 10, registered: 5,
  regClose: "2026-05-31T23:59:59Z", withdrawalClose: "2026-05-31T23:59:59Z", submittedAgo: "now", activity: [], ...overrides,
});
const registration = (overrides: Partial<RegistrationRecord> = {}): RegistrationRecord => ({
  id: "REG-TEST", eventId: "EVT-TEST", attendeeName: "Sam Adeyemi", attendeeEmail: "sam.adeyemi@student.connectsphere.edu",
  status: "registered", registeredAt: "2026-05-01T00:00:00Z", updatedAt: "2026-05-01T00:00:00Z", ...overrides,
});

describe("US29 registration rules", () => {
  it("registers when registration is open and capacity remains", () => {
    expect(decideRegistration(event(), undefined, Date.parse("2026-05-01T00:00:00Z"))).toEqual({ ok: true, status: "registered" });
  });

  it("waitlists when capacity is full", () => {
    expect(decideRegistration(event({ registered: 10 }), undefined, Date.parse("2026-05-01T00:00:00Z"))).toEqual({ ok: true, status: "waitlisted" });
  });

  it("rejects a duplicate active registration", () => {
    expect(decideRegistration(event(), registration(), Date.parse("2026-05-01T00:00:00Z")).ok).toBe(false);
  });

  it("rejects registration until the event is Confirmed", () => {
    for (const status of ["draft", "submitted", "under_review", "approved", "rejected", "cancelled"] as const) {
      expect(decideRegistration(event({ status }), undefined, Date.parse("2026-05-01T00:00:00Z"))).toEqual({ ok: false, reason: "Registration is not open for this event." });
    }
  });

  it("rejects registration when the event has registration turned off", () => {
    expect(decideRegistration(event({ reg: false }), undefined, Date.parse("2026-05-01T00:00:00Z")).ok).toBe(false);
  });

  it("rejects registration after closing time", () => {
    expect(decideRegistration(event(), undefined, future)).toEqual({ ok: false, reason: "Registration for Test Event has closed." });
  });
});

describe("US31 withdrawal rules", () => {
  it("allows withdrawal before the deadline", () => {
    expect(withdrawalError(event(), registration(), Date.parse("2026-05-01T00:00:00Z"))).toBeNull();
  });

  it("rejects withdrawal after the deadline", () => {
    expect(withdrawalError(event(), registration(), future)).toBe("The withdrawal deadline for Test Event has passed.");
  });

  it("rejects withdrawal without an active registration", () => {
    expect(withdrawalError(event(), registration({ status: "withdrawn" }), Date.parse("2026-05-01T00:00:00Z"))).toBe("No active registration was found.");
  });
});
