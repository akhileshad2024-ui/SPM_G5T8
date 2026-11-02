import { expect, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { HANNAH, PRIYA, apiAs, signIn, unique, type Account } from "./app";
import { confirmVia, requestVenue } from "./bookings";
import { DANIEL, createVenue, eventFor, type VenueFields } from "./venues";

/**
 * Helpers for the Operational Safety Check functional tests (US44).
 *
 * "Given" steps (an event whose venue is confirmed, sending it to the check) go through the API; "When" and "Then"
 * steps go through the browser, on the Safety Officer's Safety checks page and the coordinator's event workspace.
 */

export interface ReadyEvent {
  eventId: number;
  name: string;
  venueName: string;
  priya: APIRequestContext;
}

export interface ReadyOptions {
  attendance?: number;
  /** Fields of the venue, which is otherwise a roomy theatre with no setup or turnaround time. */
  venue?: Partial<VenueFields>;
  /** The coordinator acknowledges the venue is not fully suitable (e.g. smaller than the attendance). */
  acknowledged?: boolean;
  /** The accessibility the event needs; the venue offers Wheelchair Access only. */
  accessibility?: string[];
}

/** Given: an approved event of Priya's whose venue booking Venue Staff have approved (no equipment asked for). */
export async function readyEvent(baseURL: string, label: string, opts: ReadyOptions = {}): Promise<ReadyEvent> {
  const staff = await apiAs(baseURL, DANIEL);
  const priya = await apiAs(baseURL, PRIYA);
  const name = unique(label);
  const venue = await createVenue(staff, { name: unique("Safety Hall"), cap: 300, layouts: ["theatre"], setupMinutes: 0, turnaroundMinutes: 0, ...opts.venue });
  const eventId = await eventFor(baseURL, name, { attendance: opts.attendance, accessibility: opts.accessibility });
  const booking = await requestVenue(priya, venue.id, eventId, opts.acknowledged ?? false);
  await confirmVia(staff, booking.id);
  return { eventId, name, venueName: venue.name, priya };
}

/** Given: the coordinator has sent the event to its safety check, through the API. */
export async function sendToCheck(priya: APIRequestContext, eventId: number): Promise<void> {
  const res = await priya.post(`/api/events/${eventId}/safety-check/request`);
  expect(res.status(), await res.text()).toBe(200);
}

/** Given: a Safety Officer has decided, through the API. */
export async function decideVia(officer: APIRequestContext, eventId: number, outcome: "approved" | "changes_requested" | "rejected", comment = ""): Promise<void> {
  const res = await officer.post(`/api/events/${eventId}/safety-check`, { data: { outcome, comment } });
  expect(res.status(), await res.text()).toBe(200);
}

/** Signs in as a Safety Officer and waits for the Safety checks page. */
export async function openSafetyChecks(page: Page, who: Account = HANNAH): Promise<void> {
  await signIn(page, who, /\/safety/);
  await expect(page.getByText(/Awaiting a safety check \(\d+\)/)).toBeVisible();
}

/** On the Safety checks page: the events waiting for a check. The tests share one database, so look for an event, not a count. */
export function awaiting(page: Page) {
  return page.locator('section[aria-label="Awaiting a safety check"]');
}

/** On the Safety checks page: the events already decided. */
export function reviewed(page: Page) {
  return page.locator('section[aria-label="Already reviewed"]');
}

/** On the Safety checks page: the card of the event called `name`. */
export function safetyCard(scope: Page | Locator, name: string) {
  return scope.locator(`[aria-label="Safety check: ${name}"]`);
}

/** In a safety check's card: one of the seven things reviewed, by its heading. */
export function reviewArea(card: ReturnType<typeof safetyCard>, label: string) {
  return card.locator(`section[aria-label="${label}"]`);
}
