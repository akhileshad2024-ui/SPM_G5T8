/**
 * Small builders for the venue chunk's tests (lib/venues, components/venues, components/catalogue):
 * a venue, an event and a saved booking with sensible defaults, so each test gives only what it is about.
 */
import type { ApiVenue, BookingConflict, EventRecord, Venue, VenueBookingRecord } from "../../../lib/types";

export function makeVenue(overrides: Partial<Venue> = {}): Venue {
  return {
    id: "V1",
    name: "Hall A",
    location: "Block A",
    cap: 200,
    layouts: ["banquet", "theatre"],
    facilities: ["Stage"],
    accessibility: ["Wheelchair Access"],
    operatingHours: "08:00 - 22:00",
    operatingDays: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    unavailability: [],
    setupMinutes: 0,
    turnaroundMinutes: 0,
    isActive: true,
    lastUpdatedBy: "Venue Staff",
    lastUpdatedAt: "2027-01-01T00:00:00Z",
    ...overrides,
  };
}

export function makeApiVenue(overrides: Partial<ApiVenue> = {}): ApiVenue {
  return {
    id: 1,
    name: "Hall A",
    location: "Block A",
    cap: 200,
    layouts: ["banquet"],
    facilities: ["Stage"],
    accessibility: [],
    operatingHours: "08:00 - 22:00",
    operatingDays: ["Monday"],
    unavailability: [],
    setupMinutes: 15,
    turnaroundMinutes: 30,
    is_active: true,
    last_updated_by: "Venue Staff",
    last_updated_at: "2027-01-01T00:00:00Z",
    ...overrides,
  };
}

/** 2027-01-04 is a Monday. */
export function makeEvent(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    id: "EV-1",
    backendId: 1,
    name: "Design Keynote",
    organiser: "Maya Rahman",
    status: "approved",
    date: "2027-01-04",
    day: 1,
    start: "10:00",
    end: "12:00",
    pax: 100,
    purpose: "Talk",
    layout: "theatre",
    facilities: ["Stage"],
    access: [],
    coordinator: null,
    venue: null,
    bookingState: null,
    equip: [],
    equipState: null,
    reg: false,
    regCap: 0,
    registered: 0,
    submittedAgo: "1d",
    activity: [],
    ...overrides,
  } as EventRecord;
}

export function makeBooking(overrides: Partial<VenueBookingRecord> = {}): VenueBookingRecord {
  return {
    id: 1, event_id: 1, event_name: "Design Keynote", venue_id: 1, venue_name: "Hall A",
    date: "2027-01-04", start: "10:00", end: "12:00", setup_minutes: 0, teardown_minutes: 0,
    hold_start: "2027-01-04T10:00:00", hold_end: "2027-01-04T12:00:00", attendance: 100, layout: "theatre",
    purpose: null, status: "pending", verdict: "suitable", requested_by: "priya", requested_at: "2027-01-01T00:00:00Z",
    override: null, decided_by: null, decided_at: null, decision_reason: null,
    flag: null, reassessment: null, conflicts: [],
    ...overrides,
  };
}

export function makeConflict(overrides: Partial<BookingConflict> = {}): BookingConflict {
  return {
    kind: "pending_request", message: "Overlaps", blocks_approval: false,
    booking_id: 2, event_id: 2, event_name: "Other", status: "pending",
    date: null, start: null, end: null, occupied_start: null, occupied_end: null,
    period_start: null, period_end: null, reason: null, note: null,
    ...overrides,
  };
}
