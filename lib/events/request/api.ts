import type {
  BookingState,
  EquipmentCatalogueItem,
  EquipmentState,
  EventRecord,
  EventStatus,
  Layout,
  NewRequestForm,
} from "../../types";
import { eventRequestFromForm } from "./form-adapter";

/** Body for the backend's POST /events and PUT /events/{id} (backend/schemas.py EventRequestIn). */
export interface EventRequestBody {
  submit: boolean;
  name: string;
  description: string;
  eventType: string;
  expectedAttendance: number | null;
  preferredDate: string | null;
  startTime: string | null;
  endTime: string | null;
  venue: {
    location: string;
    capacity: number | null;
    layout: string | null;
    accessibility: string[];
    facilities: string[];
  };
  equipment: Array<{ type: string; quantity: number; technicalRequirements: string }>;
  registration: { required: boolean; capacityLimit: number | null; closingDate: string | null };
  draftForm: NewRequestForm | null;
}

/** The event as the backend returns it (backend/schemas.py EventResponse). */
export interface SavedEvent {
  id: number;
  status: string;
  organiser: string;
  submittedAt: string | null;
}

/** A stored event in full, as GET /events returns it (backend/schemas.py EventResponse). */
export interface StoredEvent extends SavedEvent {
  name: string;
  coordinator: string | null;
  purpose: string;
  eventType: string;
  pax: number | null;
  date: string | null;
  start: string | null;
  end: string | null;
  venueLocation: string;
  venueCapacity: number | null;
  layout: string | null;
  facilities: string[];
  access: string[];
  equip: Array<{ id: string; qty: number; technicalRequirements: string }>;
  reg: boolean;
  regCap: number | null;
  regClose: string | null;
  venue: number | null;
  bookingState: string | null;
  equipState: string | null;
  draftForm: NewRequestForm | null;
}

/** Frontend id for an event stored in the backend. */
export function eventKey(id: number): string {
  return `EVT-${id}`;
}

/** "14 Mar 2026" from "2026-03-14", the label the event lists show. */
function dateLabel(iso: string | null): string {
  if (!iso) return "Date to confirm";
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

/** Turns a stored event from GET /events into the shape the pages use. */
export function eventFromApi(e: StoredEvent): EventRecord {
  const draft = e.status === "draft";
  return {
    id: eventKey(e.id),
    backendId: e.id,
    name: e.name,
    organiser: e.organiser,
    status: e.status as EventStatus,
    date: dateLabel(e.date),
    day: null,
    start: e.start?.slice(0, 5) ?? "",
    end: e.end?.slice(0, 5) ?? "",
    pax: e.pax ?? 0,
    purpose: e.purpose || "No description provided yet.",
    layout: (e.layout ?? "banquet") as Layout,
    facilities: e.facilities,
    access: e.access,
    coordinator: e.coordinator,
    venue: e.venue === null ? null : String(e.venue),
    bookingState: e.bookingState as BookingState,
    equip: e.equip,
    equipState: e.equipState as EquipmentState,
    reg: e.reg,
    regCap: e.regCap ?? 0,
    registered: 0,
    submittedAgo: draft ? "draft · saved" : "submitted",
    activity: [
      draft
        ? { title: "Draft saved", when: "", body: "Saved without submitting. Still editable." }
        : { title: "Request submitted", when: "", body: `${e.organiser} submitted the request for review.` },
    ],
    eventType: e.eventType,
    venueLocation: e.venueLocation,
    venueCapacity: e.venueCapacity ?? 0,
    regClose: e.regClose,
    submittedAt: e.submittedAt ?? undefined,
    draftForm: e.draftForm ?? undefined,
  };
}

/** A positive whole number, or null for blank / unfinished input (allowed in drafts). */
function positiveOrNull(value: number): number | null {
  return Number.isInteger(value) && value > 0 ? value : null;
}

function textOrNull(value: string | null): string | null {
  return value && value.trim() ? value.trim() : null;
}

/**
 * Builds the POST /events body from the wizard form.
 *
 * Reuses the US03 form adapter, then adjusts it for the API: blank inputs are
 * sent as null instead of "" or 0, and equipment is identified by catalogue id
 * (e.g. "E1"), which is what events store.
 */
export function eventRequestBody(
  form: NewRequestForm,
  equipmentCatalogue: EquipmentCatalogueItem[],
  submit: boolean,
): EventRequestBody {
  const draft = eventRequestFromForm(form, equipmentCatalogue);
  const requested = equipmentCatalogue.filter((item) => (form.equip[item.id] ?? 0) > 0);

  return {
    submit,
    name: draft.name,
    description: draft.description,
    eventType: draft.eventType,
    expectedAttendance: positiveOrNull(draft.expectedAttendance),
    preferredDate: textOrNull(draft.preferredDate),
    startTime: textOrNull(draft.startTime),
    endTime: textOrNull(draft.endTime),
    venue: {
      ...draft.venue,
      capacity: positiveOrNull(draft.venue.capacity),
      layout: textOrNull(draft.venue.layout),
    },
    equipment: requested.map((item, index) => ({
      ...draft.equipment[index],
      type: item.id,
    })),
    registration: {
      required: draft.registration.required,
      capacityLimit: draft.registration.capacityLimit === null
        ? null
        : positiveOrNull(draft.registration.capacityLimit),
      closingDate: textOrNull(draft.registration.closingDate),
    },
    draftForm: submit ? null : structuredClone(form),
  };
}
