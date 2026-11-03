import { expect, test, type Page } from "@playwright/test";
import { HANNAH, MAYA, PRIYA, action, apiAs, openInQueue, signIn, toast, unique, workspaceStatus } from "./support/app";
import { requestVenue } from "./support/bookings";
import { decideVia, readyEvent, sendToCheck } from "./support/safety";
import { DANIEL, createVenue, observed } from "./support/venues";

/**
 * US14 — Confirm Event (functional). Week 7 changes CR-W7-2, CR-W7-3, CR-W7-6.
 * "As an Event Coordinator, I want to confirm an event once its essential arrangements are complete so that
 * the Event Organiser knows the arrangements are finalised."
 *
 * "Given" steps (an approved event with its venue booked, the safety check) go through the API, reusing the
 * US44 helpers; Priya confirms in the browser. Acceptance criteria: docs/user-stories/US14_confirm_event.md
 */

const checklist = (page: Page) => page.getByLabel("Outstanding before confirming").locator("li");
const confirmation = (page: Page) => page.getByLabel("Confirmation");

/** Given: an event whose venue is approved and whose safety check Hannah approved. */
async function safetyApproved(baseURL: string, label: string) {
  const ready = await readyEvent(baseURL, label);
  await sendToCheck(ready.priya, ready.eventId);
  await decideVia(await apiAs(baseURL, HANNAH), ready.eventId, "approved");
  return ready;
}

async function openAsPriya(page: Page, name: string) {
  await signIn(page, PRIYA, /\/queue/);
  await openInQueue(page, name);
}

test.describe("US14 - Confirm Event", () => {
  test("[US14-AC1] [US14-AC3] a fully arranged, safety-approved event is confirmed", async ({ page, baseURL }, info) => {
    const { name } = await safetyApproved(baseURL!, "Career Fair");

    await openAsPriya(page, name);
    await expect(confirmation(page)).toContainText("is ready to confirm");
    await action(page, "Confirm event").click();

    await expect(toast(page)).toContainText(`${name} confirmed.`);
    await expect(workspaceStatus(page)).toHaveText("Confirmed");
    await page.reload();
    await openInQueue(page, name);
    await expect(workspaceStatus(page)).toHaveText("Confirmed");
    await expect(confirmation(page)).toContainText(`Confirmed by ${PRIYA.name} on `);
    observed(info, `Priya confirmed "${name}"; after a reload it was Confirmed and the card read "${await confirmation(page).innerText()}".`);
  });

  test("[US14-AC2] [US14-AC1] every outstanding arrangement is listed", async ({ page, baseURL }, info) => {
    // Given: an approved event with one booking approved and a second one still pending (CR-W7-3), no safety check yet.
    const ready = await readyEvent(baseURL!, "Research Conference");
    const breakout = await createVenue(await apiAs(baseURL!, DANIEL), { name: unique("Breakout"), cap: 300, layouts: ["theatre"], setupMinutes: 0, turnaroundMinutes: 0 });
    await requestVenue(ready.priya, breakout.id, ready.eventId);

    await openAsPriya(page, ready.name);

    await expect(checklist(page)).toHaveText([
      `The booking at ${breakout.name} is still waiting for Venue Staff's approval.`,
      "The Safety Officer hasn't approved the Operational Safety Check yet (the event is Approved).",
    ]);
    observed(info, `The checklist listed the pending booking at ${breakout.name} and the missing safety approval.`);
  });

  test("[US14-AC7] an event can't be confirmed before the Safety Officer approves it", async ({ page, baseURL }) => {
    const ready = await readyEvent(baseURL!, "Open House");
    await sendToCheck(ready.priya, ready.eventId);

    await openAsPriya(page, ready.name);

    await expect(action(page, "Confirm event")).toHaveCount(0);
    await expect(checklist(page)).toHaveText(["The Safety Officer hasn't approved the Operational Safety Check yet (the event is Pending Safety Review)."]);
    const refused = await ready.priya.post(`/api/events/${ready.eventId}/confirm`);
    expect(refused.status()).toBe(409);
  });

  test("[US14-AC6] a booking whose venue became unavailable blocks confirmation", async ({ page, baseURL }, info) => {
    const ready = await safetyApproved(baseURL!, "Science Fair");
    // CR-W7-2 / US39: Venue Staff mark the venue unavailable over the event.
    const staff = await apiAs(baseURL!, DANIEL);
    const venue = (await (await staff.get("/api/venues")).json()).find((v: { name: string }) => v.name === ready.venueName);
    const day = (await (await ready.priya.get(`/api/events/${ready.eventId}`)).json()).date;
    const marked = await staff.put(`/api/venues/${venue.id}`, { data: { unavailability: [
      { start: `${day}T00:00:00`, end: `${day}T23:59:00`, reason: "maintenance", note: "Ceiling repair" }] } });
    expect(marked.ok(), await marked.text()).toBeTruthy();

    await openAsPriya(page, ready.name);
    await action(page, "Confirm event").click();

    await expect(toast(page)).toContainText(`The booking at ${ready.venueName} needs alternative arrangements`);
    await expect(workspaceStatus(page)).toHaveText("Safety Approved");
    observed(info, `With ${ready.venueName} marked unavailable, Confirm was refused: "${await toast(page).innerText()}".`);
  });

  test("[US14-AC4] the organiser is told the event is confirmed", async ({ page, baseURL }, info) => {
    const { name, eventId, priya } = await safetyApproved(baseURL!, "Pitch Night");
    expect((await priya.post(`/api/events/${eventId}/confirm`)).ok()).toBeTruthy();

    await signIn(page, MAYA, /\/my-events/);
    await page.getByRole("button", { name: /Notifications/ }).click();

    const notice = page.locator('[class*="NotificationsPanel_item__"]', { hasText: name }).filter({ hasText: "Event confirmed" });
    await expect(notice).toContainText("is confirmed. All arrangements are final.");
    observed(info, `Maya's notifications: "${await notice.innerText()}".`);
  });

  test("[US14-AC5] once confirmed, the details and equipment are shown as locked", async ({ page, baseURL }, info) => {
    const { name, eventId, priya } = await safetyApproved(baseURL!, "Design Week");
    expect((await priya.post(`/api/events/${eventId}/confirm`)).ok()).toBeTruthy();

    await openAsPriya(page, name);

    await expect(confirmation(page)).toContainText("Locked: name, description, event type, expected attendance, date, start time, end time");
    await expect(confirmation(page)).toContainText("equipment request. Any further change goes through a change request.");
    const edit = await priya.patch(`/api/events/${eventId}/details`, { data: { pax: 999 } });
    expect(edit.status()).toBe(409);
    observed(info, `The confirmed event's card listed the locked fields; editing the attendance through the API was refused (409).`);
  });
});
