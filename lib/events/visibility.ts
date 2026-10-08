/**
 * Which events each role is allowed to see (US02). Pure functions over the
 * event list, used by the organiser, attendee and coordinator pages.
 */
import { reviewQueue as coordinatorQueue } from "./review/review";
import type { EventRecord, QueueFilter } from "../types";

/** Organiser's "My events": only the requests they organise, drafts included. */
export function organiserEvents(events: EventRecord[], organiser: string): EventRecord[] {
  return events.filter((e) => e.organiser === organiser);
}

/**
 * Attendee's "Browse events": only confirmed events open for registration. An approved event
 * can still change venue or date while it is being arranged, so it is published once confirmed.
 */
export function publishedEvents(events: EventRecord[]): EventRecord[] {
  return events.filter((e) => e.reg && e.status === "confirmed");
}

/** Coordinator's review queue. Drafts are private to their organiser, so never listed. */
export function reviewQueue(events: EventRecord[], filter: QueueFilter, coordinator: string, search = ""): EventRecord[] {
  return coordinatorQueue(events, { filter, search, me: coordinator });
}
