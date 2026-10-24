/**
 * Shared domain types for the ConnectSphere prototype.
 *
 * Users and venues come from the FastAPI backend; everything else describes
 * the in-memory data held in `AppProvider` (see `lib/state/app-context.tsx`).
 */

export type Role = "organiser" | "coordinator" | "venue" | "tech" | "attendee";

export type EventStatus =
  | "draft"
  | "submitted"
  | "under_review"
  | "pending_clarification"
  | "approved"
  | "confirmed"
  | "rejected"
  | "cancelled";

export type BookingState = "pending" | "approved" | "rejected" | null;
export type EquipmentState = "requested" | "reserved" | null;

export type RegistrationStatus = "registered" | "waitlisted" | "withdrawn" | "cancelled";

export interface RegistrationRecord {
  id: string;
  /** The event's frontend id ("EVT-12"). */
  eventId: string;
  /** The event as it was when listed, so My registrations can show it even once it leaves Browse (e.g. cancelled). */
  eventName?: string;
  eventDate?: string;
  eventStart?: string;
  eventEnd?: string;
  attendeeName: string;
  attendeeEmail: string;
  status: RegistrationStatus;
  registeredAt: string;
  updatedAt: string;
}

export type Layout = "banquet" | "theatre" | "standing" | "boardroom" | "classroom";

/** The signed-in account, as returned by the backend's /auth/me. */
export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: Role;
}

export interface Person {
  person: string;
  label: string;
  email: string;
}

export type UnavailabilityReason =
  | "maintenance"
  | "equipment_failure"
  | "renovation"
  | "safety"
  | "internal_activity"
  | "other";

/** A period when a venue can't be used (Week 7 change #2). Times are local, "YYYY-MM-DDTHH:MM[:SS]". */
export interface UnavailabilityPeriod {
  start: string;
  end: string;
  reason: UnavailabilityReason;
  note?: string | null;
}

/** A venue from the catalogue (backend /venues), with the id as a string to match `EventRecord.venue`. */
export interface Venue {
  id: string;
  name: string;
  location: string;
  cap: number;
  /** Lower case, matching `Layout` values ("banquet", "theatre", ...). */
  layouts: string[];
  facilities: string[];
  accessibility: string[];
  /** "HH:MM - HH:MM", or null when not recorded. */
  operatingHours: string | null;
  /** Full day names, Monday first. */
  operatingDays: string[];
  unavailability: UnavailabilityPeriod[];
  /** Minutes the room is occupied before / after every event (Week 7 change #1). */
  setupMinutes: number;
  turnaroundMinutes: number;
  isActive: boolean;
  lastUpdatedBy: string;
  lastUpdatedAt: string;
}

export type SuitabilityVerdict = "suitable" | "partially_suitable" | "unsuitable";

/** One of an event's venue needs compared with what a venue offers (backend `RequirementCheck`). */
export interface RequirementCheck {
  key: "capacity" | "layout" | "facility" | "accessibility" | "availability";
  label: string;
  needed: string;
  offered: string;
  met: boolean;
  severity: "block" | "warn";
  reason: string | null;
}

export interface VenueSuitability {
  venue: ApiVenue;
  verdict: SuitabilityVerdict;
  checks: RequirementCheck[];
}

export interface BookingOverride {
  verdict: SuitabilityVerdict;
  acknowledged_by: string;
  acknowledged_at: string;
  unmet: Array<{ label: string; severity: "block" | "warn"; reason: string }>;
}

/** A saved venue booking request as the backend returns it (backend `VenueBooking`). */
export interface VenueBookingRecord {
  id: number;
  event_id: number;
  event_name: string;
  venue_id: number;
  venue_name: string;
  date: string;
  start: string;
  end: string;
  setup_minutes: number;
  teardown_minutes: number;
  hold_start: string;
  hold_end: string;
  attendance: number;
  layout: string;
  /** US41: what this booking is for, e.g. "Main programme" or "Breakout session". */
  purpose: string | null;
  /** pending and approved bookings hold the venue; rejected, cancelled and expired (US42) ones do not. */
  status: "pending" | "approved" | "rejected" | "cancelled" | "expired";
  verdict: SuitabilityVerdict;
  requested_by: string;
  requested_at: string;
  override: BookingOverride | null;
  decided_by: string | null;
  decided_at: string | null;
  decision_reason: string | null;
  /** US39: set while the venue is unavailable during this booking; the coordinator must arrange an alternative. */
  flag: BookingFlag | null;
  /** US42: when this tentative hold lapses unless approved (ISO), and the Venue Staff member who set it (null = default). */
  hold_expires_at?: string | null;
  hold_expiry_set_by?: string | null;
  /** US42: what the coordinator should be told, worked out by the server. */
  hold_notice?: "expiring_soon" | "expired" | null;
  /** US23-AC5: set for 7 days after Venue Staff decide, so the requesting coordinator is told. */
  decision_notice?: "approved" | "rejected" | null;
}

export interface BookingFlag {
  kind: "venue_unavailable";
  reason: UnavailabilityReason;
  note: string | null;
  period_start: string;
  period_end: string;
  message: string;
  flagged_at: string;
}

export interface BookingRequestResponse {
  booking: VenueBookingRecord;
  notification: { to: Role; title: string; body: string };
}

/** The venue as the backend sends it. */
export interface ApiVenue extends Omit<Venue, "id" | "isActive" | "lastUpdatedBy" | "lastUpdatedAt"> {
  id: number;
  is_active: boolean;
  last_updated_by: string;
  last_updated_at: string;
  /** PUT /venues/{id} only (US39): the bookings an unavailability change has newly flagged. */
  flagged_bookings?: VenueBookingRecord[];
}

/** Body for POST /venues and PUT /venues/{id}. */
export type VenueInput = Omit<Venue, "id" | "isActive" | "lastUpdatedBy" | "lastUpdatedAt">;

export interface EquipmentCatalogueItem {
  id: string;
  name: string;
  total: number;
}

export interface EquipmentLine {
  id: string;
  qty: number;
  technicalRequirements?: string;
}

export interface ActivityEntry {
  title: string;
  when: string;
  body: string;
}

/** US16 partial API input. Ownership, status and booking decisions are excluded. */
export interface EventDetailsUpdate {
  name?: string;
  purpose?: string | null;
  eventType?: string | null;
  pax?: number | null;
  date?: string | null;
  start?: string | null;
  end?: string | null;
  venueLocation?: string | null;
  venueCapacity?: number | null;
  layout?: Layout | null;
  facilities?: string[];
  access?: string[];
  equip?: EquipmentLine[];
  reg?: boolean;
  regCap?: number | null;
  regClose?: string | null;
}

export interface EventDetailChange {
  id: number;
  changes: EventDetailsUpdate;
  changedBy: string;
  changedAt: string;
  affectsArrangements: boolean;
}

export interface EventRecord {
  id: string;
  /** Database id once the request is stored by the backend (US03); absent for sample data. */
  backendId?: number;
  name: string;
  organiser: string;
  status: EventStatus;
  date: string;
  /** Day-of-week column (2 = Tue .. 6 = Sat) used by the venue availability grid. */
  day: number | null;
  start: string;
  end: string;
  pax: number;
  purpose: string;
  layout: Layout;
  facilities: string[];
  access: string[];
  coordinator: string | null;
  venue: string | null;
  bookingState: BookingState;
  equip: EquipmentLine[];
  equipState: EquipmentState;
  reg: boolean;
  regCap: number;
  registered: number;
  /** Set once the signed-in attendee has registered themselves. */
  myReg?: boolean;
  submittedAgo: string;
  activity: ActivityEntry[];
  changeNote?: string;
  /** US03/US04 fields added by the event-request workflow. */
  eventType?: string;
  venueLocation?: string;
  venueCapacity?: number;
  regClose?: string | null;
  withdrawalClose?: string;
  submittedAt?: string;
  /** US15: name of the booked venue, for roles that see where the event is but not the booking. */
  venueName?: string | null;
  /** US15: when the event's details were last saved (ISO, UTC). */
  updatedAt?: string;
  /** Preserves unfinished form values so an organiser can continue a draft. */
  draftForm?: NewRequestForm;
  /** US22: the venue booking request as the backend recorded it (pending, venue held from setup to teardown). */
  bookingRequest?: VenueBookingRecord;
  /** US41: every venue booking of the event (it may book several venues), oldest first. */
  bookings?: VenueBookingRecord[];
  /** US21: each time the coordinator went ahead with a venue that was not fully suitable, oldest first. */
  venueOverrides?: BookingOverride[];
  /** US08: the latest clarification / amendment request sent to the organiser. */
  clarification?: ClarificationRequest;
  /** US10: the coordinator's final review outcome, visible to the organiser. */
  decision?: ReviewDecision;
}

/** The person performing a review action (taken from the session, never from input). */
export interface Actor {
  name: string;
  role: Role;
}

export type ClarificationKind = "clarification" | "amendment";

export interface ClarificationRequest {
  kind: ClarificationKind;
  message: string;
  requestedBy: string;
  requestedAt: string;
  /** US09: a saved response never directly edits the event's submitted fields. */
  response?: { message: string; respondedBy: string; respondedAt: string };
  history?: ClarificationRequest[];
}

export interface ReviewDecision {
  outcome: "approved" | "rejected";
  by: string;
  at: string;
  /** Mandatory when rejected; optional note when approved. */
  reason?: string;
}

/** A notification produced by a workflow step; the context adds id/when/read. */
export type WorkflowNotification = Pick<NotificationRecord, "to" | "title" | "body">;

/**
 * Every review-workflow step either returns the updated event plus the
 * notifications it triggers, or explains why the action is not allowed.
 */
export type WorkflowResult =
  | { ok: true; event: EventRecord; notifications: WorkflowNotification[] }
  | { ok: false; error: string };

export interface NotificationRecord {
  id: number;
  to: Role;
  title: string;
  body: string;
  when: string;
  read: boolean;
}

export type ToastKind = "ok" | "warn" | "bad";

export type ModalKind =
  | "clarify"
  | "amend"
  | "approve"
  | "reject"
  | "rejectBooking"
  | "change";

export interface ModalState {
  kind: ModalKind;
  id: string;
  /** rejectBooking: which of the event's bookings (US41: an event may have several). */
  bookingId?: number;
  title: string;
  body: string;
  label: string;
  placeholder: string;
  confirm: string;
}

export type QueueFilter = "action" | "unassigned" | "mine" | "all";
export type EventTab = "request" | "venue" | "equipment" | "registration" | "activity";

export interface VenueFilter {
  cap: string;
  layout: Layout | "any";
}

/** The search form on the Venues page (US20). Empty strings / arrays mean "not filtering on this". */
export interface VenueSearchFilters {
  date: string;
  start: string;
  end: string;
  attendance: string;
  location: string;
  accessibility: string[];
  layout: Layout | "";
  facilities: string[];
}

/** Which filter an applied-filter chip stands for; the backend's `AppliedFilter.key`. */
export type VenueFilterKey = "timing" | "attendance" | "location" | "accessibility" | "layout" | "facilities";

/** One filter in use, as the backend describes it for display. */
export interface AppliedVenueFilter {
  key: VenueFilterKey;
  label: string;
  value: string;
}

/** The backend's answer to POST /venues/search. */
export interface VenueSearchResponse {
  venues: ApiVenue[];
  total: number;
  applied_filters: AppliedVenueFilter[];
  message: string | null;
}

export interface NewRequestForm {
  name: string;
  purpose: string;
  eventType: string;
  date: string;
  start: string;
  end: string;
  pax: string;
  venueLocation: string;
  venueCapacity: string;
  layout: Layout;
  facilities: string[];
  access: string[];
  /** equipment id -> quantity requested */
  equip: Record<string, number>;
  /** equipment id -> technical requirements */
  equipTechnical: Record<string, string>;
  reg: boolean;
  regCap: string;
  regClose: string;
}

/** Data entered while an organiser creates an event request. */
export interface EventRequestDraft {
  name: string;
  description: string;
  eventType: string;
  expectedAttendance: number;
  preferredDate: string;
  startTime: string;
  endTime: string;
  venue: {
    location: string;
    capacity: number;
    layout: string;
    accessibility: string[];
    facilities: string[];
  };
  equipment: Array<{
    type: string;
    quantity: number;
    technicalRequirements: string;
  }>;
  registration: {
    required: boolean;
    capacityLimit: number | null;
    closingDate: string | null;
  };
}

/** Field name to human-readable validation message. */
export type EventRequestErrors = Record<string, string>;

/** Result returned by the US03 validation function. */
export interface ValidationResult {
  valid: boolean;
  errors: EventRequestErrors;
}

/** A valid request after US04 has submitted it for review. */
export interface SubmittedEventRequest extends EventRequestDraft {
  status: "submitted";
  submittedAt: string;
}

/** US04 either returns a submitted request or the fields blocking submission. */
export type SubmissionResult =
  | {
      ok: true;
      request: SubmittedEventRequest;
    }
  | {
      ok: false;
      outstandingFields: string[];
    };


/** Persisted organiser request returned by the draft/submission endpoints. */
export interface ApiEventDraft {
  id: number;
  status: EventStatus;
  submitted_at?: string | null;
  draft_form: NewRequestForm;
}
/** US33 proposals are separate from EventRecord's current values. */
export interface EventChangeRequest {
  id: number;
  event_id: number;
  requested_by_id: number;
  requested_at: string;
  proposed_changes: string;
  status: string;
  decision: Record<string, unknown> | null;
}
