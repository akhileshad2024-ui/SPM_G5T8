import { expect, test, type Page } from "@playwright/test";
import { GRACE, MARCUS, MAYA, PRIYA, WEI, apiAs, assignTo, createRequest, signIn, startReviewVia, unique } from "./support/app";
import { confirmVia, requestVenue } from "./support/bookings";
import { DANIEL, createVenue, observed, updateVenue } from "./support/venues";

/**
 * US19 — View Venue Availability Calendar (functional). Week 7 changes CR-W7-1, CR-W7-4.
 * "As an authorised internal user, I want to view a venue availability calendar showing bookings and
 * recorded unavailable periods so that I can identify potential event times."
 *
 * "Given" steps (venues, requests, bookings) go through the API as the people who make them; the viewer
 * then reads the calendar in the browser. Test cases: docs/US19-functional-tests.md.
 */

const DAY_MS = 24 * 3600 * 1000;

/** The date createRequest books for (30 days from now), as "YYYY-MM-DD". */
const eventDay = () => new Date(Date.now() + 30 * DAY_MS).toISOString().slice(0, 10);

/** Given: Maya's request is approved by Priya and ready to book. Returns its id. */
async function approvedEvent(baseURL: string, name: string): Promise<number> {
  const priya = await apiAs(baseURL, PRIYA);
  const eventId = await createRequest(await apiAs(baseURL, MAYA), name);
  await assignTo(await apiAs(baseURL, GRACE), eventId, PRIYA);
  await startReviewVia(priya, eventId);
  const res = await priya.post(`/api/events/${eventId}/decision`, { data: { outcome: "approved", reason: "" } });
  expect(res.ok(), await res.text()).toBeTruthy();
  return eventId;
}

/** Opens the calendar on `day`, for the one venue, once it has loaded. */
async function showDay(page: Page, venue: string, day: string): Promise<void> {
  await page.getByLabel("Go to date").fill(day);
  await page.getByLabel("Venue", { exact: true }).selectOption({ label: venue });
}

function cell(page: Page, venue: string, day: string) {
  return page.getByRole("group", { name: `${venue} on ${day}` });
}

async function signOut(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);
}

test.describe("US19 - View Venue Availability Calendar", () => {
  test("[TC-US19-01] [US19-AC1] [US19-AC3] [US19-AC4] Venue Staff see a confirmed booking with its setup and turnaround", async ({ page, baseURL }, info) => {
    const staff = await apiAs(baseURL!, DANIEL);
    const venue = await createVenue(staff);
    const name = unique("Robotics Showcase");
    const booking = await requestVenue(await apiAs(baseURL!, PRIYA), venue.id, await approvedEvent(baseURL!, name));
    await confirmVia(staff, booking.id);

    await signIn(page, DANIEL, /\/bookings/);
    await showDay(page, venue.name, eventDay());
    const period = page.getByLabel(`Confirmed: ${name}`);
    await expect(period).toContainText("09:30–12:45");
    await expect(period).toContainText("Event 10:00–12:00, 30 min setup, 45 min turnaround");
    observed(info, `Daniel saw "${name}" as Confirmed: "${await period.innerText()}".`);
  });

  test("[TC-US19-02] [US19-AC1] [US19-AC4] [US19-AC6] a pending request shows when its hold expires", async ({ page, baseURL }, info) => {
    const staff = await apiAs(baseURL!, DANIEL);
    const venue = await createVenue(staff);
    const name = unique("Design Expo");
    await requestVenue(await apiAs(baseURL!, PRIYA), venue.id, await approvedEvent(baseURL!, name));

    await signIn(page, DANIEL, /\/bookings/);
    await showDay(page, venue.name, eventDay());
    const period = page.getByLabel(`Pending: ${name}`);
    await expect(period).toContainText("Held until");
    observed(info, `Daniel saw "${name}" as Pending: "${await period.innerText()}".`);
  });

  test("[TC-US19-03] [US19-AC1] an unavailable period shows on the calendar with its reason", async ({ page, baseURL }, info) => {
    const staff = await apiAs(baseURL!, DANIEL);
    const venue = await createVenue(staff);
    const day = eventDay();
    await updateVenue(staff, venue.id, {
      unavailability: [{ start: `${day}T08:00`, end: `${day}T20:00`, reason: "maintenance", note: "Floor repairs" }],
    });

    await signIn(page, DANIEL, /\/bookings/);
    await showDay(page, venue.name, day);
    const period = page.getByLabel("Unavailable: Maintenance: Floor repairs");
    await expect(period).toContainText("08:00–20:00");
    observed(info, `Daniel saw the unavailable period: "${await period.innerText()}".`);
  });

  test("[TC-US19-04] [US19-AC2] the calendar moves by day, week and month", async ({ page, baseURL }, info) => {
    const staff = await apiAs(baseURL!, DANIEL);
    const venue = await createVenue(staff);
    const day = "2027-03-10"; // a Wednesday
    await updateVenue(staff, venue.id, {
      unavailability: [{ start: `${day}T08:00`, end: `${day}T20:00`, reason: "renovation" }],
    });

    await signIn(page, PRIYA, /\/queue/);
    await page.getByRole("link", { name: "Venue calendar" }).click();
    await showDay(page, venue.name, day);
    await expect(page.getByText("Venue availability · 08 Mar 2027 – 14 Mar 2027")).toBeVisible();
    await expect(cell(page, venue.name, day)).toContainText("Renovation");

    await page.getByRole("button", { name: "Next week" }).click();
    await expect(page.getByText("Venue availability · 15 Mar 2027 – 21 Mar 2027")).toBeVisible();
    await expect(cell(page, venue.name, "2027-03-17")).not.toContainText("Renovation");

    await page.getByRole("button", { name: "Previous week" }).click();
    await page.getByRole("button", { name: "Day", exact: true }).click();
    await expect(page.getByText(`Venue availability · 10 Mar 2027`)).toBeVisible();
    await expect(cell(page, venue.name, day)).toContainText("Renovation");

    await page.getByRole("button", { name: "Month", exact: true }).click();
    await expect(page.getByText("Venue availability · March 2027")).toBeVisible();
    await expect(page.getByRole("group", { name: day, exact: true })).toContainText("Renovation");
    observed(info, "Priya stepped through week, next week, day and month, and the period showed only on its own date.");
  });

  test("[TC-US19-05] [US19-AC5] someone not involved sees the venue busy but not the event", async ({ page, baseURL }, info) => {
    const staff = await apiAs(baseURL!, DANIEL);
    const venue = await createVenue(staff);
    const name = unique("Private Summit");
    const booking = await requestVenue(await apiAs(baseURL!, PRIYA), venue.id, await approvedEvent(baseURL!, name));
    await confirmVia(staff, booking.id);

    await signIn(page, MARCUS, /\/queue/);
    await page.goto("/calendar");
    await showDay(page, venue.name, eventDay());
    await expect(page.getByLabel("Confirmed: Booked")).toContainText("09:30–12:45");
    await expect(page.getByText(name)).toHaveCount(0);
    observed(info, `Marcus, who doesn't coordinate ${name}, saw "Booked" 09:30–12:45 and not the event's name.`);
  });

  test("[TC-US19-06] [US19-AC5] Technical Support and the Lead can open the calendar; an organiser can't", async ({ page, baseURL }, info) => {
    await signIn(page, WEI, /\/equipment/);
    await page.getByRole("link", { name: "Venue calendar" }).click();
    await expect(page.getByText(/^Venue availability ·/)).toBeVisible();

    await signOut(page);
    await signIn(page, GRACE, /\/assignments/);
    await page.getByRole("link", { name: "Venue calendar" }).click();
    await expect(page.getByText(/^Venue availability ·/)).toBeVisible();

    await signOut(page);
    await signIn(page, MAYA, /\/my-events/);
    await expect(page.getByRole("link", { name: "Venue calendar" })).toHaveCount(0);
    await page.goto("/calendar");
    await expect(page).toHaveURL(/\/my-events/);
    observed(info, "Wei and Grace opened Venue calendar from the sidebar; Maya has no link and was sent back to My events.");
  });
});
