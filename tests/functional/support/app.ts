import { expect, request, type APIRequestContext, type Page } from "@playwright/test";

/**
 * Helpers for the functional tests.
 *
 * "Given" steps (creating a request, assigning it) go through the API, so each test
 * starts from exactly the state it needs. "When" and "Then" steps go through the
 * browser, as a real user would.
 */

// Keep in sync with tests/functional/support/seed_users.py.
export const PASSWORD = "Functional-Test-1";
export const MAYA = { email: "maya.rahman@connectsphere.edu", name: "Maya Rahman" }; // Event Organiser
export const PRIYA = { email: "priya.tan@connectsphere.edu", name: "Priya Tan" }; // Event Coordinator
export const MARCUS = { email: "marcus.lee@connectsphere.edu", name: "Marcus Lee" }; // Event Coordinator

type Account = typeof MAYA;

/** An API session signed in as `who`, talking to the app through its /api proxy. */
export async function apiAs(baseURL: string, who: Account): Promise<APIRequestContext> {
  const api = await request.newContext({ baseURL });
  const res = await api.post("/api/auth/login", { data: { email: who.email, password: PASSWORD } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return api;
}

export interface RequestOptions {
  submit?: boolean;
  attendance?: number;
  venueCapacity?: number;
}

/** Given: Maya has saved (and by default submitted) a request called `name`. Returns its id. */
export async function createRequest(organiser: APIRequestContext, name: string, opts: RequestOptions = {}): Promise<number> {
  const future = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const res = await organiser.post("/api/events", {
    data: {
      submit: opts.submit ?? true,
      name,
      description: "Functional test request.",
      eventType: "Conference",
      expectedAttendance: opts.attendance ?? 120,
      preferredDate: future,
      startTime: "10:00",
      endTime: "12:00",
      venue: { location: "Central campus", capacity: opts.venueCapacity ?? 150, layout: "theatre", accessibility: [], facilities: [] },
      equipment: [],
      registration: { required: false, capacityLimit: null, closingDate: null },
    },
  });
  expect(res.status(), await res.text()).toBe(201);
  return (await res.json()).id;
}

/** Given: the event is assigned to `who` (US11), through the API. */
export async function assignTo(coordinatorApi: APIRequestContext, eventId: number, who: Account): Promise<void> {
  const coordinators: Array<{ id: number; name: string }> = await (await coordinatorApi.get("/api/coordinators")).json();
  const account = coordinators.find((c) => c.name === who.name);
  expect(account, `${who.name} should be a coordinator account`).toBeTruthy();
  const res = await coordinatorApi.post(`/api/events/${eventId}/assign`, { data: { coordinatorId: account!.id } });
  expect(res.ok(), await res.text()).toBeTruthy();
}

/** Given: the assigned coordinator has started the review (US07), through the API. */
export async function startReviewVia(coordinatorApi: APIRequestContext, eventId: number): Promise<void> {
  const res = await coordinatorApi.post(`/api/events/${eventId}/review`, { data: {} });
  expect(res.ok(), await res.text()).toBeTruthy();
}

/** Signs in through the login page and waits for the role's landing page. */
export async function signIn(page: Page, who: Account, landing: RegExp): Promise<void> {
  await page.goto("/login");
  await page.getByPlaceholder("you@connectsphere.edu").fill(who.email);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(landing);
}

/** On the review queue: show every event, search for `name`, and open it. */
export async function openInQueue(page: Page, name: string): Promise<void> {
  if (!page.url().includes("/queue")) await page.goto("/queue");
  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.getByPlaceholder(/search events/i).fill(name);
  await page.getByRole("button", { name: new RegExp(name) }).first().click();
  await expect(workspaceTitle(page, name)).toBeVisible();
}

/** The event's name in the workspace header (not the queue row). */
export function workspaceTitle(page: Page, name: string) {
  return page.locator('[class*="EventWorkspace"][class*="name"]', { hasText: name });
}

/** The status pill in the workspace header. */
export function workspaceStatus(page: Page) {
  return page.locator('[class*="EventWorkspace"][class*="headerTop"] .pill');
}

/** The short-lived message at the bottom of the screen. */
export function toast(page: Page) {
  return page.locator(".cs-animate-toast");
}

/** Fills the open dialog's text box and presses its confirm button. */
export async function submitDialog(page: Page, text: string, confirm: string): Promise<void> {
  if (text) await page.locator("textarea.textarea-input").fill(text);
  await page.getByRole("button", { name: confirm, exact: true }).click();
}

/** A name unique to this test run, so tests never see each other's events. */
export function unique(label: string): string {
  return `${label} ${Date.now().toString(36)}`;
}

/** The organiser's row for `name` on My Events. */
export function myEventsRow(page: Page, name: string) {
  return page.locator('[class*="MyEventsTable"][class*="row"]', { hasText: name });
}

/**
 * A workspace action button ("Approve", "Reject", ...), matched exactly: queue rows are
 * buttons too, and their text includes the status ("Rejected", "awaiting organiser reply").
 */
export function action(page: Page, label: string) {
  return page.getByRole("button", { name: label, exact: true });
}
