import type { Actor, EventRecord } from "../../../lib/types";

export const NOW = new Date("2030-05-10T08:30:00.000Z");

export const COORDINATOR: Actor = { name: "Priya Tan", role: "coordinator" };
export const OTHER_COORDINATOR: Actor = { name: "Marcus Lee", role: "coordinator" };
export const ORGANISER: Actor = { name: "Maya Rahman", role: "organiser" };
export const ROSTER = ["Priya Tan", "Marcus Lee", "Aisha Noor"] as const;

/**
 * Creates a fresh submitted event for each test. Each test overrides only the
 * fields it examines, so one test cannot leak state into another.
 */
export function createEvent(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: "EVT-3001",
    name: "Alumni Homecoming Dinner",
    organiser: "Maya Rahman",
    status: "submitted",
    date: "15 Jun 2030",
    day: null,
    start: "19:00",
    end: "23:00",
    pax: 180,
    purpose: "Annual reunion dinner for alumni.",
    layout: "banquet",
    facilities: ["Stage", "PA system"],
    access: ["Step-free access"],
    coordinator: null,
    venue: null,
    bookingState: null,
    equip: [{ id: "E1", qty: 2, technicalRequirements: "Spare batteries" }],
    equipState: "requested",
    reg: true,
    regCap: 200,
    registered: 0,
    submittedAgo: "submitted 2 days ago",
    activity: [{ title: "Request submitted", when: "2 days ago", body: "Maya Rahman submitted the request." }],
    eventType: "dinner",
    venueLocation: "Central campus",
    venueCapacity: 200,
    regClose: "2030-06-10",
    submittedAt: "2030-05-08T08:30:00.000Z",
    ...overrides,
  };
}

export const QUESTION = "Can the 320 attendees be split across two rooms?";

/** An event the given coordinator is assigned to and actively reviewing. */
export function createUnderReview(overrides: Partial<EventRecord> = {}): EventRecord {
  return createEvent({ status: "under_review", coordinator: COORDINATOR.name, ...overrides });
}

/** An event waiting on the organiser to answer QUESTION (built directly, not via US08). */
export function createPendingClarification(): EventRecord {
  return createUnderReview({
    status: "pending_clarification",
    clarification: {
      kind: "clarification",
      message: QUESTION,
      requestedBy: COORDINATOR.name,
      requestedAt: NOW.toISOString(),
    },
  });
}
