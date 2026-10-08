/**
 * Shared domain types for the ConnectSphere prototype.
 *
 * There is no backend: everything here describes the shape of the
 * in-memory data held in `AppProvider` (see `lib/app-context.tsx`).
 */

export type Role = "organiser" | "coordinator" | "venue" | "tech" | "attendee";

export type EventStatus =
  | "draft"
  | "submitted"
  | "under_review"
  | "approved"
  | "planning"
  | "confirmed"
  | "completed"
  | "rejected"
  | "cancelled";

export type BookingState = "pending" | "approved" | "rejected" | null;
export type EquipmentState = "requested" | "reserved" | null;
export type RegistrationStatus = "registered" | "waitlisted" | "withdrawn" | "cancelled";

export interface RegistrationRecord {
  id: string;
  eventId: string;
  attendeeName: string;
  attendeeEmail: string;
  status: RegistrationStatus;
  registeredAt: string;
  updatedAt: string;
}

export type Layout = "banquet" | "theatre" | "standing" | "boardroom" | "classroom";

export interface Person {
  person: string;
  label: string;
  email: string;
}

export interface Venue {
  id: string;
  name: string;
  location: string;
  cap: number;
  layouts: Layout[];
  facilities: string[];
  stepFree: boolean;
}

export interface EquipmentCatalogueItem {
  id: string;
  name: string;
  total: number;
}

export interface EquipmentLine {
  id: string;
  qty: number;
}

export interface ActivityEntry {
  title: string;
  when: string;
  body: string;
}

export interface EventRecord {
  id: string;
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
  regClose?: string;
  withdrawalClose?: string;
  /** Set once the signed-in attendee has registered themselves. */
  myReg?: boolean;
  submittedAgo: string;
  activity: ActivityEntry[];
  changeNote?: string;
}

export interface NotificationRecord {
  id: number;
  to: Role;
  title: string;
  body: string;
  when: string;
  read: boolean;
}

export type ToastKind = "ok" | "warn" | "bad";

export type ModalKind = "clarify" | "reject" | "rejectBooking" | "change";

export interface ModalState {
  kind: ModalKind;
  id: string;
  title: string;
  body: string;
  label: string;
  placeholder: string;
  confirm: string;
}

export type QueueFilter = "action" | "mine" | "all";
export type EventTab = "request" | "venue" | "equipment" | "registration" | "activity";

export interface VenueFilter {
  cap: string;
  layout: Layout | "any";
  stepFree: boolean;
}

export interface NewRequestForm {
  name: string;
  purpose: string;
  date: string;
  start: string;
  end: string;
  pax: string;
  layout: Layout;
  facilities: string[];
  access: string[];
  /** equipment id -> quantity requested */
  equip: Record<string, number>;
  reg: boolean;
  regCap: string;
  regClose: string;
}
