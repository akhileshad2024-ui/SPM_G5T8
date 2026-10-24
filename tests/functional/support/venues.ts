import { expect, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";
import { GRACE, MAYA, PRIYA, apiAs, assignTo, startReviewVia, unique } from "./app";

/**
 * Helpers for the venue functional tests (US17, US18, US20, US21, US22, US37).
 *
 * "Given" steps (creating venues, an approved event) go through the API; "When" and "Then"
 * steps go through the browser. Names and locations are unique per test, so tests that share
 * the one database never see each other's venues.
 */

// Keep in sync with tests/functional/support/seed_users.py.
export const DANIEL = { email: "daniel.ortiz@connectsphere.edu", name: "Daniel Ortiz" }; // Venue Staff

export const ALL_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export interface VenueFields {
  name: string;
  location: string;
  cap: number;
  layouts: string[];
  facilities: string[];
  accessibility: string[];
  operatingHours: string;
  operatingDays: string[];
  setupMinutes: number;
  turnaroundMinutes: number;
  unavailability: Array<{ start: string; end: string; reason: string; note?: string }>;
}

export interface Venue extends VenueFields {
  id: number;
  is_active: boolean;
}

/** Given: Venue Staff has added a venue. Open every day 06:00-23:00 unless the test says otherwise. */
export async function createVenue(staff: APIRequestContext, overrides: Partial<VenueFields> = {}): Promise<Venue> {
  const fields: VenueFields = {
    name: unique("Hall"),
    location: unique("Plaza"),
    cap: 200,
    layouts: ["theatre", "classroom"],
    facilities: ["Projector", "PA system"],
    accessibility: ["Wheelchair Access"],
    operatingHours: "06:00 - 23:00",
    operatingDays: ALL_DAYS,
    setupMinutes: 30,
    turnaroundMinutes: 45,
    unavailability: [],
    ...overrides,
  };
  const res = await staff.post("/api/venues", { data: fields });
  expect(res.status(), await res.text()).toBe(200);
  return res.json();
}

/** Given: Venue Staff changes an existing venue. */
export async function updateVenue(staff: APIRequestContext, id: number, changes: Record<string, unknown>): Promise<void> {
  const res = await staff.put(`/api/venues/${id}`, { data: changes });
  expect(res.ok(), await res.text()).toBeTruthy();
}

/** A date `daysAhead` days from today, as YYYY-MM-DD. */
export function futureDate(daysAhead = 30): string {
  return new Date(Date.now() + daysAhead * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

export interface EventOptions {
  attendance?: number;
  layout?: string;
  facilities?: string[];
  accessibility?: string[];
  date?: string;
  start?: string;
  end?: string;
}

/** Given: Maya's request is submitted, assigned to Priya, under review and (if `approve`) approved. Returns its id. */
export async function eventFor(baseURL: string, name: string, opts: EventOptions = {}, approve = true): Promise<number> {
  const maya = await apiAs(baseURL, MAYA);
  const priya = await apiAs(baseURL, PRIYA);
  const res = await maya.post("/api/events", {
    data: {
      submit: true,
      name,
      description: "Functional test event.",
      eventType: "Conference",
      expectedAttendance: opts.attendance ?? 120,
      preferredDate: opts.date ?? futureDate(),
      startTime: opts.start ?? "10:00",
      endTime: opts.end ?? "12:00",
      venue: {
        location: "Central campus",
        capacity: 150,
        layout: opts.layout ?? "theatre",
        accessibility: opts.accessibility ?? [],
        facilities: opts.facilities ?? [],
      },
      equipment: [],
      registration: { required: false, capacityLimit: null, closingDate: null },
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  const id: number = (await res.json()).id;
  await assignTo(await apiAs(baseURL, GRACE), id, PRIYA);
  await startReviewVia(priya, id);
  if (approve) {
    const decision = await priya.post(`/api/events/${id}/decision`, { data: { outcome: "approved", reason: "" } });
    expect(decision.ok(), await decision.text()).toBeTruthy();
  }
  return id;
}

/** On /catalogue: the card for the venue called `name`. */
export function catalogueCard(page: Page, name: string) {
  return page.locator(".card", { hasText: name }).filter({ has: page.getByText(name, { exact: true }) });
}

/** On /venues: the list row for the venue called `name`. */
export function venueRow(page: Page, name: string) {
  return page.locator(".card", { has: page.getByText(name, { exact: true }) }).filter({ has: page.getByRole("button", { name: /view details|loading/i }) });
}

/** On an event's Venue tab: the result card for the venue called `name`. */
export function resultCard(page: Page, name: string) {
  return page.locator(".card", { has: page.getByText(name, { exact: true }) }).filter({ has: page.getByText(/suitable|unsuitable/i) });
}

/** On an event's Venue tab: show every venue (the "Minimum capacity" filter starts at 180). */
export async function showAllVenues(page: Page): Promise<void> {
  await page.locator('input[class*="capInput"]').fill("0");
}

/** Opens the event's Venue tab from the review queue. */
export async function openVenueTab(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Venue", exact: true }).click();
  await showAllVenues(page);
}

/**
 * Records what the test actually saw, shown with the test in the Playwright report.
 * Only state things the test has just checked.
 */
export function observed(info: TestInfo, text: string): void {
  info.annotations.push({ type: "actual", description: text });
}

/** "2026-11-22" -> "22 Nov 2026", the way the booking and suitability screens write dates. */
export function dateLabel(iso: string): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [year, month, day] = iso.split("-");
  return `${day} ${months[Number(month) - 1]} ${year}`;
}
