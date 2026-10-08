import assert from "node:assert/strict";
import { decideRegistration, withdrawalError } from "../lib/registration.ts";
import type { EventRecord, RegistrationRecord } from "../lib/types.ts";

const future = Date.parse("2026-06-01T00:00:00Z");
const event = (overrides: Partial<EventRecord> = {}): EventRecord => ({
  id: "EVT-TEST", name: "Test Event", organiser: "Maya Rahman", status: "planning", date: "01 Jun 2026", day: null,
  start: "10:00", end: "11:00", pax: 10, purpose: "Test", layout: "theatre", facilities: [], access: [], coordinator: "Priya Tan",
  venue: null, bookingState: null, equip: [], equipState: null, reg: true, regCap: 10, registered: 5,
  regClose: "2026-05-31T23:59:59Z", withdrawalClose: "2026-05-31T23:59:59Z", submittedAgo: "now", activity: [], ...overrides,
});
const registration = (overrides: Partial<RegistrationRecord> = {}): RegistrationRecord => ({
  id: "REG-TEST", eventId: "EVT-TEST", attendeeName: "Sam Adeyemi", attendeeEmail: "sam.adeyemi@student.connectsphere.edu",
  status: "registered", registeredAt: "2026-05-01T00:00:00Z", updatedAt: "2026-05-01T00:00:00Z", ...overrides,
});

function test(name: string, body: () => void) {
  body();
  console.log(`PASS ${name}`);
}

test("US29 registers when registration is open and capacity remains", () => {
  assert.deepEqual(decideRegistration(event(), undefined, Date.parse("2026-05-01T00:00:00Z")), { ok: true, status: "registered" });
});

test("US29 waitlists when capacity is full", () => {
  assert.deepEqual(decideRegistration(event({ registered: 10 }), undefined, Date.parse("2026-05-01T00:00:00Z")), { ok: true, status: "waitlisted" });
});

test("US29 rejects a duplicate active registration", () => {
  assert.equal(decideRegistration(event(), registration(), Date.parse("2026-05-01T00:00:00Z")).ok, false);
});

test("US29 rejects registration after closing time", () => {
  const result = decideRegistration(event(), undefined, future);
  assert.deepEqual(result, { ok: false, reason: "Registration for Test Event has closed." });
});

test("US31 allows withdrawal before the deadline", () => {
  assert.equal(withdrawalError(event(), registration(), Date.parse("2026-05-01T00:00:00Z")), null);
});

test("US31 rejects withdrawal after the deadline", () => {
  assert.equal(withdrawalError(event(), registration(), future), "The withdrawal deadline for Test Event has passed.");
});

test("US31 rejects withdrawal without an active registration", () => {
  assert.equal(withdrawalError(event(), registration({ status: "withdrawn" }), Date.parse("2026-05-01T00:00:00Z")), "No active registration was found.");
});
