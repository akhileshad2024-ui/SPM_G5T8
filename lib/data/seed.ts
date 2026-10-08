/**
 * Demo data: the sample people, events and notifications the app starts with.
 * Events are being moved to the backend (POST /events); the rest is still in memory.
 */
import type { EventRecord, NotificationRecord, Person, Role } from "../types";

export const PEOPLE: Record<Role, Person> = {
  organiser: { person: "Maya Rahman", label: "Event Organiser", email: "maya.rahman@connectsphere.edu" },
  coordinator: { person: "Priya Tan", label: "Event Coordinator", email: "priya.tan@connectsphere.edu" },
  venue: { person: "Daniel Ortiz", label: "Venue Staff", email: "daniel.ortiz@connectsphere.edu" },
  tech: { person: "Wei Lim", label: "Technical Support", email: "wei.lim@connectsphere.edu" },
  attendee: { person: "Sam Adeyemi", label: "Attendee", email: "sam.adeyemi@student.connectsphere.edu" },
};

/**
 * Staff holding the Event Coordinator role, who can be assigned to events
 * (US11). Only Priya Tan has a login in the demo; the others show that a
 * request can be given to a coordinator other than the person assigning it.
 */
export const COORDINATORS: readonly string[] = [PEOPLE.coordinator.person, "Marcus Lee", "Aisha Noor"];

/**
 * The sample events below refer to venues by these placeholder ids. Once the real
 * catalogue loads from the backend, each is pointed at the venue with the same name
 * (run `python -m seed_venues` in backend/ to add them).
 */
export const SEED_VENUE_NAMES: Record<string, string> = {
  V1: "Grand Hall",
  V2: "The Atrium",
  V3: "Lecture Theatre 1",
  V4: "Seminar Room 4-2",
  V5: "Innovation Studio",
};

export function seedEvents(): EventRecord[] {
  return [
    { id: "EVT-2041", name: "Alumni Homecoming Dinner", organiser: "Maya Rahman", status: "submitted", date: "14 Mar 2026", start: "19:00", end: "23:00", pax: 180, day: 3, purpose: "An annual reunion dinner for alumni of the last twenty cohorts, with a short address from the Dean and table-side networking over a seated meal.", layout: "banquet", facilities: ["Stage", "PA system", "Projector"], access: ["Step-free access", "Hearing loop"], coordinator: null, venue: null, bookingState: null, equip: [{ id: "E1", qty: 2 }, { id: "E2", qty: 1 }, { id: "E3", qty: 1 }], equipState: "requested", reg: true, regCap: 200, registered: 0, submittedAgo: "submitted 2 days ago",
      activity: [{ title: "Request submitted", when: "2 days ago", body: "Maya Rahman submitted the request for review." }, { title: "Draft saved", when: "4 days ago", body: "Draft created with venue and equipment requirements." }] },
    { id: "EVT-2038", name: "Research Symposium — Day 1", organiser: "Lin Chen", status: "pending_clarification", date: "02 Apr 2026", start: "09:00", end: "17:00", pax: 320, day: null, purpose: "A full-day symposium presenting funded research across four faculties, with parallel poster sessions and an external keynote.", layout: "theatre", facilities: ["Projector", "PA system", "Hearing loop"], access: ["Step-free access"], coordinator: "Priya Tan", venue: null, bookingState: null, equip: [{ id: "E2", qty: 2 }, { id: "E1", qty: 4 }, { id: "E5", qty: 1 }], equipState: "requested", reg: true, regCap: 300, registered: 46, submittedAgo: "awaiting organiser reply · 2 days",
      clarification: { kind: "clarification", message: "Can the 320 attendees be split across two rooms? No single venue meets that capacity.", requestedBy: "Priya Tan", requestedAt: "2026-03-01T09:00:00.000Z" },
      activity: [{ title: "Clarification requested", when: "2 days ago", body: "Priya Tan asked whether 320 attendees can be split across two rooms, as no single venue meets that capacity." }, { title: "Assigned to Priya Tan", when: "3 days ago", body: "Coordinator assigned." }, { title: "Request submitted", when: "3 days ago", body: "Lin Chen submitted the request for review." }] },
    { id: "EVT-2044", name: "Startup Pitch Night", organiser: "Ana Silva", status: "submitted", date: "21 Mar 2026", start: "18:30", end: "21:00", pax: 95, day: null, purpose: "Eight student ventures pitch to a panel of investors, followed by an informal networking reception.", layout: "standing", facilities: ["Projector", "PA system"], access: ["Step-free access"], coordinator: null, venue: null, bookingState: null, equip: [{ id: "E2", qty: 1 }, { id: "E1", qty: 2 }], equipState: "requested", reg: true, regCap: 120, registered: 0, submittedAgo: "submitted 6 hours ago",
      activity: [{ title: "Request submitted", when: "6 hours ago", body: "Ana Silva submitted the request for review." }] },
    { id: "EVT-2045", name: "Faculty Onboarding Workshop", organiser: "Kwame Osei", status: "submitted", date: "08 Apr 2026", start: "14:00", end: "17:00", pax: 40, day: null, purpose: "A hands-on onboarding session for incoming faculty covering teaching systems, assessment policy, and research support.", layout: "classroom", facilities: ["Projector", "Whiteboard"], access: ["Step-free access"], coordinator: null, venue: null, bookingState: null, equip: [{ id: "E2", qty: 1 }], equipState: "requested", reg: false, regCap: 0, registered: 0, submittedAgo: "submitted yesterday",
      activity: [{ title: "Request submitted", when: "yesterday", body: "Kwame Osei submitted the request for review." }] },
    { id: "EVT-2030", name: "Design Week Keynote", organiser: "Maya Rahman", status: "planning", date: "18 Mar 2026", start: "10:00", end: "12:00", pax: 200, day: null, purpose: "Opening keynote for Design Week, with a visiting practitioner and a moderated audience discussion.", layout: "theatre", facilities: ["Stage", "PA system", "Projector"], access: ["Step-free access", "Hearing loop"], coordinator: "Priya Tan", venue: "V1", bookingState: "approved", equip: [{ id: "E1", qty: 3 }, { id: "E4", qty: 1 }], equipState: "requested", reg: true, regCap: 200, registered: 138, submittedAgo: "approved 5 days ago",
      activity: [{ title: "Venue booking approved", when: "4 days ago", body: "Daniel Ortiz approved Grand Hall for 18 Mar, 10:00–12:00." }, { title: "Request approved", when: "5 days ago", body: "Priya Tan approved the request and moved it into planning." }] },
    { id: "EVT-2028", name: "Industry Career Fair", organiser: "Jihoon Park", status: "planning", date: "11 Mar 2026", start: "09:00", end: "17:00", pax: 250, day: 3, purpose: "Sixty employers host booths across the Atrium for a full-day recruitment fair open to all final-year students.", layout: "standing", facilities: ["PA system"], access: ["Step-free access"], coordinator: "Priya Tan", venue: "V2", bookingState: "approved", equip: [{ id: "E3", qty: 2 }, { id: "E1", qty: 2 }], equipState: "reserved", reg: true, regCap: 400, registered: 311, submittedAgo: "in planning",
      activity: [{ title: "Venue booking approved", when: "9 days ago", body: "Daniel Ortiz approved The Atrium for 11 Mar, 07:00–18:00 including setup." }] },
    { id: "EVT-2035", name: "Sustainability Forum", organiser: "Jihoon Park", status: "planning", date: "11 Mar 2026", start: "18:00", end: "21:00", pax: 190, day: 3, purpose: "An evening panel on campus decarbonisation, with student researchers presenting alongside two city planners.", layout: "standing", facilities: ["PA system"], access: ["Step-free access"], coordinator: "Priya Tan", venue: "V2", bookingState: "pending", equip: [{ id: "E1", qty: 2 }, { id: "E3", qty: 1 }], equipState: "requested", reg: true, regCap: 200, registered: 62, submittedAgo: "venue booking pending · 1 day",
      activity: [{ title: "Venue booking requested", when: "1 day ago", body: "The Atrium requested for 11 Mar, 18:00–21:00." }, { title: "Request approved", when: "2 days ago", body: "Priya Tan approved the request and moved it into planning." }] },
    { id: "EVT-2012", name: "Open House 2026", organiser: "Tariq Ibrahim", status: "confirmed", date: "10 Mar 2026", start: "09:00", end: "17:00", pax: 300, day: 2, purpose: "Campus-wide open day for prospective students and their families, with faculty talks and guided tours.", layout: "standing", facilities: ["Stage", "PA system", "Projector"], access: ["Step-free access", "Hearing loop"], coordinator: "Priya Tan", venue: "V1", bookingState: "approved", equip: [{ id: "E1", qty: 4 }, { id: "E3", qty: 2 }], equipState: "reserved", reg: true, regCap: 300, registered: 214, submittedAgo: "confirmed",
      activity: [{ title: "Event confirmed", when: "3 weeks ago", body: "All arrangements in place. Attendees notified." }] },
    { id: "EVT-2050", name: "Postgrad Mixer", organiser: "Maya Rahman", status: "draft", date: "25 Apr 2026", start: "18:00", end: "21:00", pax: 70, day: null, purpose: "An informal mixer for incoming postgraduate researchers across departments.", layout: "standing", facilities: ["PA system"], access: [], coordinator: null, venue: null, bookingState: null, equip: [], equipState: null, reg: false, regCap: 0, registered: 0, submittedAgo: "draft · last edited yesterday",
      activity: [{ title: "Draft created", when: "yesterday", body: "Not yet submitted for review." }] },
  ];
}

export function seedNotifs(): NotificationRecord[] {
  return [
    { id: 1, to: "coordinator", title: "New event request", body: "Alumni Homecoming Dinner was submitted by Maya Rahman and needs review.", when: "2d", read: false },
    { id: 2, to: "coordinator", title: "New event request", body: "Startup Pitch Night was submitted by Ana Silva.", when: "6h", read: false },
    { id: 3, to: "organiser", title: "Clarification requested", body: "Your Research Symposium request needs a response on room capacity.", when: "2d", read: false },
    { id: 4, to: "venue", title: "Booking request pending", body: "The Atrium requested for Industry Career Fair on 11 Mar.", when: "1d", read: false },
    { id: 5, to: "tech", title: "Equipment requested", body: "Design Week Keynote needs 3 wireless microphones and a lighting rig.", when: "3d", read: false },
    { id: 6, to: "attendee", title: "Registration confirmed", body: "You are registered for Open House 2026 on 10 Mar.", when: "1w", read: true },
  ];
}
