/**
 * Small builders for the pages-and-shell chunk's tests (app/, components/layout, login, browse, board,
 * Modal, Toast): an event, a saved booking and a registration with sensible defaults, so each test
 * gives only what it is about.
 */
import type { EventRecord, NotificationRecord, RegistrationRecord, VenueBookingRecord } from "../../lib/types";

/** 2027-01-04 is a Monday. */
export function makeEvent(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: "EVT-1",
    backendId: 1,
    name: "Design Keynote",
    organiser: "Maya Rahman",
    status: "approved",
    date: "2027-01-04",
    day: 1,
    start: "10:00",
    end: "12:00",
    pax: 120,
    purpose: "A talk on product design.",
    layout: "theatre",
    facilities: [],
    access: [],
    coordinator: "Priya Tan",
    venue: null,
    bookingState: null,
    equip: [],
    equipState: null,
    reg: false,
    regCap: 0,
    registered: 0,
    submittedAgo: "today",
    activity: [],
    ...overrides,
  } as EventRecord;
}

export function makeBooking(overrides: Partial<VenueBookingRecord> = {}): VenueBookingRecord {
  return {
    id: 11,
    event_id: 1,
    event_name: "Design Keynote",
    venue_id: 1,
    venue_name: "Hall A",
    date: "2027-01-04",
    start: "10:00",
    end: "12:00",
    setup_minutes: 30,
    teardown_minutes: 30,
    hold_start: "2027-01-04T09:30:00",
    hold_end: "2027-01-04T12:30:00",
    attendance: 120,
    layout: "theatre",
    purpose: null,
    status: "pending",
    verdict: "suitable",
    requested_by: "Priya Tan",
    requested_at: "2027-01-01T00:00:00Z",
    override: null,
    decided_by: null,
    decided_at: null,
    decision_reason: null,
    flag: null,
    reassessment: null,
    conflicts: [],
    ...overrides,
  } as VenueBookingRecord;
}

export function makeRegistration(overrides: Partial<RegistrationRecord> = {}): RegistrationRecord {
  return {
    id: "R-1",
    eventId: "EVT-1",
    attendeeName: "Sam Adeyemi",
    attendeeEmail: "sam.adeyemi@student.connectsphere.edu",
    status: "registered",
    registeredAt: "2027-01-01T09:00:00Z",
    updatedAt: "2027-01-01T09:00:00Z",
    ...overrides,
  };
}

export function makeNotif(overrides: Partial<NotificationRecord> = {}): NotificationRecord {
  return { id: 1, to: "coordinator", title: "New request", body: "Maya submitted a request.", when: "2m ago", read: false, ...overrides };
}
