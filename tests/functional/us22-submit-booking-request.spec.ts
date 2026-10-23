import { expect, test, type Browser, type Page } from "@playwright/test";
import { PRIYA, apiAs, openInQueue, signIn, submitDialog, toast, unique } from "./support/app";
import { DANIEL, createVenue, dateLabel, eventFor, futureDate, observed, openVenueTab, resultCard } from "./support/venues";

/**
 * US22 — Submit Venue Booking Request (functional).
 * "As an Event Coordinator, I want to submit a venue booking request containing the event timing
 * and venue requirements so that Venue Staff can assess it."
 *
 * The venue (setup 30 min, turnaround 45 min) and each event (120 people, theatre, 10:00-12:00 on
 * a future date) are made fresh for every test.
 *
 * Test cases: tests/functional/report/test_cases.py.
 */
const DATE = futureDate(35);
const BOOKING_PATH = /\/api\/venues\/\d+\/booking-requests/;

async function makeVenue(baseURL: string) {
  return createVenue(await apiAs(baseURL, DANIEL), {
    name: unique("Booking Hall"), cap: 200, layouts: ["theatre"], facilities: ["Projector"], accessibility: ["Wheelchair Access"],
    setupMinutes: 30, turnaroundMinutes: 45,
  });
}

/** An approved event that the venue fully suits, on DATE. */
const approvedEvent = (baseURL: string, name: string, extra: { start?: string; end?: string } = {}) =>
  eventFor(baseURL, name, { attendance: 120, layout: "theatre", facilities: ["Projector"], accessibility: ["Wheelchair Access"], date: DATE, ...extra });

async function openEvent(page: Page, name: string) {
  if (!page.url().includes("/queue")) await signIn(page, PRIYA, /\/queue/);
  await openInQueue(page, name);
  await openVenueTab(page);
}

/** Presses the venue's "Request booking" button and returns the request the page sent and the answer it got. */
async function requestVenue(page: Page, venueName: string) {
  const [request, response] = await Promise.all([
    page.waitForRequest((r) => BOOKING_PATH.test(r.url())),
    page.waitForResponse((r) => BOOKING_PATH.test(r.url())),
    resultCard(page, venueName).getByRole("button", { name: "Request booking", exact: true }).click(),
  ]);
  return { sent: request.postDataJSON(), got: await response.json() };
}

/** A second browser, signed in as Venue Staff, on the Booking requests page. */
async function asVenueStaff(browser: Browser, baseURL: string): Promise<Page> {
  const staffPage = await (await browser.newContext({ baseURL })).newPage();
  await signIn(staffPage, DANIEL, /\/bookings/);
  await expect(staffPage.getByText("Pending booking requests")).toBeVisible(); // the page has loaded
  return staffPage;
}

/** The pending-request card for `eventName` on Venue Staff's page. */
const requestCard = (staffPage: Page, eventName: string) =>
  staffPage.locator(".card", { has: staffPage.getByText(eventName, { exact: true }) }).filter({ has: staffPage.getByRole("button", { name: "Approve booking" }) });

test.describe("US22 - Submit Venue Booking Request", () => {
  test("[TC-US22-01] [US22-AC1] the request holds the event date, times, setup and teardown, attendance and layout", async ({ page, baseURL }, info) => {
    const venue = await makeVenue(baseURL!);
    const event = unique("Design Keynote");
    await approvedEvent(baseURL!, event);
    await signIn(page, PRIYA, /\/queue/);
    await openEvent(page, event);

    const { sent, got } = await requestVenue(page, venue.name);

    // The page names only the event: the server reads its date, times, attendance and layout from the saved event,
    // and the setup and teardown from the venue.
    expect(sent).toEqual({ event_id: expect.any(Number), acknowledged: false });
    // What was recorded: the event's timing and requirements, plus the venue's setup and teardown and the hold they make.
    expect(got.booking).toMatchObject({ date: DATE, start: "10:00", end: "12:00", attendance: 120, layout: "theatre", setup_minutes: 30, teardown_minutes: 45 });
    expect(got.booking.hold_start).toContain(`${DATE}T09:30`);
    expect(got.booking.hold_end).toContain(`${DATE}T12:45`);
    await page.getByRole("button", { name: "Activity", exact: true }).click();
    await expect(page.getByText(`${venue.name} requested for ${dateLabel(DATE)}, 10:00–12:00 (held from setup to teardown, 30 min setup and 45 min teardown).`)).toBeVisible();
    observed(info, `The page sent only the event. The saved booking recorded date ${DATE}, 10:00-12:00, attendance 120, theatre layout, setup 30 min and teardown 45 min, holding the venue ${DATE} 09:30-12:45. The Activity tab logged "${venue.name} requested for ${dateLabel(DATE)}, 10:00–12:00 (held from setup to teardown, 30 min setup and 45 min teardown)."`);
  });

  test("[TC-US22-02] [US22-AC2] a request can only be made for an event with Approved status", async ({ page, baseURL }, info) => {
    const venue = await makeVenue(baseURL!);
    const event = unique("Under Review Event");
    await eventFor(baseURL!, event, { attendance: 120, layout: "theatre", date: DATE }, false); // reviewed but not yet approved
    const sent: string[] = [];
    page.on("request", (r) => BOOKING_PATH.test(r.url()) && sent.push(r.url()));
    await openEvent(page, event);

    const card = resultCard(page, venue.name);
    await expect(card.getByText("A venue can only be requested for an approved event.")).toBeVisible();
    await card.getByRole("button", { name: "Request booking", exact: true }).click();
    await expect(toast(page)).toContainText("A venue can only be requested for an approved event.");
    expect(sent).toHaveLength(0);

    // The server refuses events in other statuses too: one waiting on clarification, one rejected.
    const priya = await apiAs(baseURL!, PRIYA);
    const clarifying = await eventFor(baseURL!, unique("Clarifying Event"), { date: DATE }, false);
    expect((await priya.post(`/api/events/${clarifying}/clarification`, { data: { kind: "clarification", message: "Can you confirm the number of attendees?" } })).ok()).toBeTruthy();
    const rejected = await eventFor(baseURL!, unique("Rejected Event"), { date: DATE }, false);
    expect((await priya.post(`/api/events/${rejected}/decision`, { data: { outcome: "rejected", reason: "Not enough detail to plan this event." } })).ok()).toBeTruthy();
    const refused: string[] = [];
    for (const [label, id] of [["pending clarification", clarifying], ["rejected", rejected]] as const) {
      const res = await priya.post(`/api/venues/${venue.id}/booking-requests`, { data: { event_id: id, acknowledged: true } });
      expect(res.status(), label).toBe(409);
      expect((await res.json()).detail).toBe(`A venue can only be requested for an approved event (this event is ${label}).`);
      refused.push(label);
    }
    observed(info, `For an event under review, the venue showed "A venue can only be requested for an approved event." and pressing Request booking sent nothing (toast with the same message). The server also refused (409) requests for events that were ${refused.join(" and ")}.`);
  });

  test("[TC-US22-03] [US22-AC3] the request is recorded as Pending and the venue is provisionally held", async ({ page, baseURL }, info) => {
    const venue = await makeVenue(baseURL!);
    const first = unique("First Event");
    const second = unique("Second Event");
    await approvedEvent(baseURL!, first);
    await approvedEvent(baseURL!, second);
    await signIn(page, PRIYA, /\/queue/);
    await openEvent(page, first);

    const { got } = await requestVenue(page, venue.name);

    expect(got.booking.status).toBe("pending");
    const card = resultCard(page, venue.name);
    await expect(card.getByRole("button", { name: "Requested", exact: true })).toBeVisible();
    await expect(card.getByText("Awaiting Venue Staff")).toBeVisible();
    await expect(page.getByRole("button", { name: "Awaiting venue decision" })).toBeVisible();

    // Held: another event for the same slot now sees the venue as taken.
    await openEvent(page, second);
    const other = resultCard(page, venue.name);
    await expect(other.locator(".pill").first()).toHaveText("Unsuitable");
    await expect(other.getByText(new RegExp(`Clashes with ${first}, already requested on ${dateLabel(DATE)}`))).toBeVisible();
    observed(info, `The booking came back with status "pending"; the venue's button changed to Requested with "Awaiting Venue Staff" and the event header showed "Awaiting venue decision". For a second event at the same time the venue became Unsuitable: "Clashes with ${first}, already requested on ${dateLabel(DATE)}".`);
  });

  test("[TC-US22-04] [US22-AC4] Venue Staff are notified of the new request", async ({ page, baseURL }, info) => {
    const venue = await makeVenue(baseURL!);
    const event = unique("Design Keynote");
    await approvedEvent(baseURL!, event);
    await signIn(page, PRIYA, /\/queue/);
    await openEvent(page, event);

    const { got } = await requestVenue(page, venue.name);

    expect(got.notification.to).toBe("venue");
    expect(got.notification.title).toBe("Booking request pending");
    expect(got.notification.body).toContain(`${venue.name} requested for ${event} on ${dateLabel(DATE)}, 10:00–12:00 (120 people, theatre layout).`);
    observed(info, `The system produced a notification addressed to Venue Staff titled "${got.notification.title}": "${got.notification.body}"`);
  });

  test("[TC-US22-05] [US22-AC4] Venue Staff can see the new request when they sign in", async ({ page, browser, baseURL }, info) => {
    const venue = await makeVenue(baseURL!);
    const event = unique("Design Keynote");
    await approvedEvent(baseURL!, event);
    await signIn(page, PRIYA, /\/queue/);
    await openEvent(page, event);
    await requestVenue(page, venue.name);

    const staffPage = await asVenueStaff(browser, baseURL!);

    const card = requestCard(staffPage, event);
    await expect(card).toBeVisible();
    await expect(card.getByText(venue.name, { exact: false })).toBeVisible();
    await expect(card.getByText(/30 min setup, 45 min teardown/)).toBeVisible();
    observed(info, `Venue Staff, signed in on their own browser, saw "${event}" listed under Pending booking requests for ${venue.name}, held with 30 min setup and 45 min teardown, with Approve booking and Reject with reason.`);
  });

  test("[TC-US22-06] [US22-AC3] the pending request is still there after the page is reloaded", async ({ page, baseURL }, info) => {
    const venue = await makeVenue(baseURL!);
    const event = unique("Design Keynote");
    await approvedEvent(baseURL!, event);
    await signIn(page, PRIYA, /\/queue/);
    await openEvent(page, event);
    await requestVenue(page, venue.name);

    await page.reload();
    await openInQueue(page, event);
    await openVenueTab(page);

    const card = resultCard(page, venue.name);
    await expect(card.getByRole("button", { name: "Requested", exact: true })).toBeVisible();
    await expect(card.getByText("Awaiting Venue Staff")).toBeVisible();
    observed(info, `After reloading the page and reopening the event, ${venue.name} still showed as Requested with "Awaiting Venue Staff".`);
  });

  test("[TC-US22-07] [US22-AC5] a second pending request for the same venue and time period is refused", async ({ page, baseURL }, info) => {
    const venue = await makeVenue(baseURL!);
    const first = unique("First Event");
    const second = unique("Second Event");
    await approvedEvent(baseURL!, first);
    await approvedEvent(baseURL!, second);
    await signIn(page, PRIYA, /\/queue/);
    await openEvent(page, first);
    await requestVenue(page, venue.name);

    // The second event wants the same venue at the same time. Even after acknowledging the warning it is refused.
    await openEvent(page, second);
    const card = resultCard(page, venue.name);
    await card.getByRole("button", { name: "Request anyway…" }).click();
    await card.getByLabel(/I acknowledge the warning/).check();
    await card.getByRole("button", { name: "Request booking anyway" }).click();

    await expect(toast(page)).toContainText(`${venue.name} already has a pending request for that period (${first}).`);
    await expect(card.getByRole("button", { name: "Requested", exact: true })).toHaveCount(0);
    observed(info, `Requesting ${venue.name} for a second event at the same time was refused with: "${venue.name} already has a pending request for that period (${first})." and the venue did not show as Requested for the second event.`);
  });

  test("[TC-US22-08] [US22-AC5] a request for the same venue straight after the first one's setup and teardown is accepted", async ({ page, baseURL }, info) => {
    const venue = await makeVenue(baseURL!);
    const first = unique("Morning Event");
    const later = unique("Afternoon Event");
    await approvedEvent(baseURL!, first); // 10:00-12:00, so the venue is held 09:30-12:45
    await approvedEvent(baseURL!, later, { start: "13:15", end: "15:00" }); // its setup starts at 12:45, exactly as the hold ends
    await signIn(page, PRIYA, /\/queue/);
    await openEvent(page, first);
    await requestVenue(page, venue.name);

    await openEvent(page, later);
    await expect(resultCard(page, venue.name).locator(".pill").first()).toHaveText("Suitable");
    const { got } = await requestVenue(page, venue.name);

    expect(got.booking.status).toBe("pending");
    await expect(toast(page)).toContainText(`Booking requested at ${venue.name}.`);
    observed(info, `An event 13:15-15:00 (setup starting 12:45, when the first request's hold ends) showed ${venue.name} as Suitable and its request was accepted as pending.`);
  });

  test("[TC-US22-09] [US22-AC3] Venue Staff can approve the request and the coordinator sees the confirmed booking", async ({ page, browser, baseURL }, info) => {
    const venue = await makeVenue(baseURL!);
    const event = unique("Design Keynote");
    await approvedEvent(baseURL!, event);
    await signIn(page, PRIYA, /\/queue/);
    await openEvent(page, event);
    await requestVenue(page, venue.name);
    const staffPage = await asVenueStaff(browser, baseURL!);

    await requestCard(staffPage, event).getByRole("button", { name: "Approve booking" }).click();
    await expect(toast(staffPage)).toContainText(`${venue.name} confirmed for ${event}.`);

    // The decision is saved: the coordinator, after a reload, sees the venue booked.
    await page.reload();
    await openInQueue(page, event);
    await openVenueTab(page);
    await expect(resultCard(page, venue.name).getByRole("button", { name: "Booked", exact: true })).toBeVisible();
    observed(info, `Venue Staff approved the request (toast "${venue.name} confirmed for ${event}."). After a reload the coordinator's Venue tab showed ${venue.name} as Booked with "Confirmed booking".`);
  });

  test("[TC-US22-10] [US22-AC3] when Venue Staff reject the request the venue is released for other events", async ({ page, browser, baseURL }, info) => {
    const venue = await makeVenue(baseURL!);
    const first = unique("First Event");
    const second = unique("Second Event");
    await approvedEvent(baseURL!, first);
    await approvedEvent(baseURL!, second);
    await signIn(page, PRIYA, /\/queue/);
    await openEvent(page, first);
    await requestVenue(page, venue.name);
    const staffPage = await asVenueStaff(browser, baseURL!);

    // A rejection needs a reason.
    await requestCard(staffPage, first).getByRole("button", { name: "Reject with reason" }).click();
    await submitDialog(staffPage, "", "Reject booking");
    await expect(toast(staffPage)).toContainText("Give a reason for rejecting the request.");
    await submitDialog(staffPage, "Held for setup that morning.", "Reject booking");
    await expect(toast(staffPage)).toContainText("Booking rejected.");

    // The venue is free again: after a reload the other event can have it.
    await page.reload();
    await openInQueue(page, second);
    await openVenueTab(page);
    await expect(resultCard(page, venue.name).locator(".pill").first()).toHaveText("Suitable");
    const { got } = await requestVenue(page, venue.name);
    expect(got.booking.status).toBe("pending");
    observed(info, `Rejecting without a reason was refused ("Give a reason for rejecting the request."); with a reason the booking was rejected. After a reload ${venue.name} showed as Suitable for another event at the same time and that request was accepted as pending.`);
  });
});
