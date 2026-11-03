import { expect, test, type Browser } from "@playwright/test";
import { PRIYA, action, openInQueue, signIn, toast, unique, workspaceStatus, workspaceTitle } from "./support/app";
import { confirmVia, decideVia, openBookings, requestCard } from "./support/bookings";
import { bookingRow, flaggedEvent, needsReplacement, replaceVia } from "./support/replacement";
import { sendToCheck } from "./support/safety";
import { createVenue, dateLabel, eventFor, observed, openVenueTab, resultCard } from "./support/venues";

/**
 * US40 — Request Replacement Venue (functional).
 * "As an Event Coordinator, I want to search for and request a replacement venue for a booking affected by
 * venue unavailability so that my event can still go ahead."
 *
 * A booking is flagged when Venue Staff make its venue unavailable (US39). The coordinator finds the flagged
 * booking, searches for a venue using its timing and needs, and asks for one, linked to the original. When Venue
 * Staff approve it, the original is released (kept for reference) and its flag cleared.
 *
 * Test cases: tests/functional/report/test_cases.py.
 */

/** The coordinator's own browser, signed in, with the event open on its Venue tab. */
async function coordinatorOnVenueTab(browser: Browser, baseURL: string, name: string) {
  const page = await (await browser.newContext({ baseURL })).newPage();
  await signIn(page, PRIYA, /\/queue/);
  await openInQueue(page, name);
  await openVenueTab(page);
  return page;
}

test.describe("US40 - Request Replacement Venue", () => {
  test("[TC-US40-01] [US40-AC1] the coordinator can see every booking flagged as needing alternative arrangements", async ({ page, baseURL }, info) => {
    const flagged = await flaggedEvent(baseURL!, "Flagged Fair");
    const steady = unique("Steady Fair");
    await eventFor(baseURL!, steady); // approved, nothing booked, nothing flagged
    await signIn(page, PRIYA, /\/queue/);

    await page.getByRole("button", { name: /^Needs a venue/ }).click();
    await expect(page.getByRole("button", { name: new RegExp(flagged.name) })).toBeVisible();
    await expect(page.getByRole("button", { name: new RegExp(steady) })).toHaveCount(0);
    await page.getByRole("button", { name: new RegExp(flagged.name) }).click();
    await expect(action(page, "Find a replacement venue")).toBeVisible();
    await openVenueTab(page);

    const section = needsReplacement(page);
    await expect(section).toContainText(flagged.original.name);
    await expect(section).toContainText(`${flagged.original.name} is unavailable (Maintenance: Floor repairs)`);
    await expect(section).toContainText("A replacement venue is required.");
    await expect(section).toContainText("40 people · Classroom layout");
    await expect(bookingRow(page, flagged.original.name)).toContainText("Needs a replacement");
    observed(info, `The Review queue's "Needs a venue" filter listed ${flagged.name} (and not ${steady}). Its workspace offered "Find a replacement venue", and its Venue tab listed the booking at ${flagged.original.name} under "Bookings needing a replacement venue" with "${flagged.original.name} is unavailable (Maintenance: Floor repairs) ... A replacement venue is required.", 40 people, Classroom layout, tagged "Needs a replacement".`);
  });

  test("[TC-US40-02] [US40-AC2] searching for a replacement starts from the original booking's timing and requirements", async ({ page, baseURL }, info) => {
    const flagged = await flaggedEvent(baseURL!, "Search Fair");
    await signIn(page, PRIYA, /\/queue/);
    await openInQueue(page, flagged.name);
    await openVenueTab(page);

    await needsReplacement(page).getByRole("button", { name: "Find a replacement venue" }).click();

    await expect(page.getByText(`Replacement for the booking at ${flagged.original.name}`, { exact: true })).toBeVisible();
    await expect(page.getByText(`Same timing as the original booking (${flagged.date}, 10:00–12:00).`)).toBeVisible();
    await expect(page.getByLabel("Attendance", { exact: true })).toHaveValue("40"); // the booking's, not the event's 120
    await expect(page.locator('[aria-label="New booking"]').getByLabel("Layout")).toHaveValue("classroom");
    await expect(page.getByLabel("Purpose", { exact: true })).toHaveValue("Breakout session");
    const spare = resultCard(page, flagged.spare.name);
    await expect(spare.getByRole("button", { name: "Request booking", exact: true })).toBeVisible();
    await expect(spare).toContainText("Suitable");
    await expect(resultCard(page, flagged.original.name).getByRole("button", { name: "Booked", exact: true })).toBeVisible(); // not offered again
    observed(info, `"Find a replacement venue" showed "Replacement for the booking at ${flagged.original.name}" and "Same timing as the original booking (${flagged.date}, 10:00–12:00).", with the booking's 40 attendance, Classroom layout and purpose "Breakout session" filled in. ${flagged.spare.name} was Suitable with "Request booking"; ${flagged.original.name} showed "Booked" and could not be chosen.`);
  });

  test("[TC-US40-03] [US40-AC3] the replacement request is linked to the original booking and Venue Staff can see that", async ({ page, browser, baseURL }, info) => {
    const flagged = await flaggedEvent(baseURL!, "Request Fair");
    await signIn(page, PRIYA, /\/queue/);
    await openInQueue(page, flagged.name);
    await openVenueTab(page);
    await needsReplacement(page).getByRole("button", { name: "Find a replacement venue" }).click();

    await resultCard(page, flagged.spare.name).getByRole("button", { name: "Request booking", exact: true }).click();

    await expect(toast(page)).toContainText(`Replacement requested at ${flagged.spare.name}. Venue Staff will review it.`);
    await expect(needsReplacement(page)).toContainText(`Replacement requested at ${flagged.spare.name} (waiting for Venue Staff).`);
    await expect(needsReplacement(page).getByRole("button", { name: "Find a replacement venue" })).toHaveCount(0); // one at a time
    await expect(bookingRow(page, flagged.spare.name)).toContainText(`Replacement for the booking at ${flagged.original.name}`);
    // Only one replacement may be open at a time, whichever venue is asked for.
    const third = await createVenue(flagged.staff, { name: unique("Third Hall"), cap: 300, layouts: ["theatre", "classroom"], setupMinutes: 0, turnaroundMinutes: 0 });
    const again = await flagged.priya.post(`/api/venues/${third.id}/booking-requests`, { data: { event_id: flagged.eventId, replaces_booking_id: flagged.bookingId } });
    expect(again.status()).toBe(409);
    expect((await again.json()).detail).toContain(`A replacement for this booking is already pending: ${flagged.spare.name}.`);

    const staff = await (await browser.newContext({ baseURL })).newPage();
    await openBookings(staff);
    const card = requestCard(staff, flagged.name, flagged.spare.name);
    await expect(card).toContainText("Replacement venue.");
    await expect(card).toContainText(`Replaces the booking at ${flagged.original.name}, which needs alternative arrangements.`);
    observed(info, `Requesting ${flagged.spare.name} from the replacement search showed "Replacement requested at ${flagged.spare.name}. Venue Staff will review it." The flagged booking then read "Replacement requested at ${flagged.spare.name} (waiting for Venue Staff)." with no second "Find a replacement venue", and the new booking read "Replacement for the booking at ${flagged.original.name}". Venue Staff's request card said "Replacement venue. Replaces the booking at ${flagged.original.name}, which needs alternative arrangements."`);
  });

  test("[TC-US40-04] [US40-AC4] the original event information and booking are kept for reference", async ({ browser, baseURL }, info) => {
    const flagged = await flaggedEvent(baseURL!, "Keep Fair");
    const replacementId = await replaceVia(flagged.priya, flagged, flagged.spare);
    await confirmVia(flagged.staff, replacementId);

    const coordinator = await coordinatorOnVenueTab(browser, baseURL!, flagged.name);

    const original = bookingRow(coordinator, flagged.original.name);
    await expect(original).toContainText("Cancelled");
    await expect(original).toContainText(`Replaced by the booking at ${flagged.spare.name}. The booking is kept for reference.`);
    await expect(original).toContainText("40 people · Classroom layout");
    await expect(bookingRow(coordinator, flagged.spare.name)).toContainText("Approved");
    await expect(workspaceStatus(coordinator)).toHaveText("Approved"); // the event itself is unchanged
    await expect(workspaceTitle(coordinator, flagged.name)).toBeVisible();
    await expect(coordinator.getByText(`${dateLabel(flagged.date)}, 10:00–12:00`, { exact: false }).first()).toBeVisible();
    observed(info, `After Venue Staff approved the replacement, ${flagged.name} was still Approved with its date and times. The booking at ${flagged.original.name} stayed on the Venue tab as Cancelled, "Replaced by the booking at ${flagged.spare.name}. The booking is kept for reference.", with its 40 people and Classroom layout.`);
  });

  test("[TC-US40-05] [US40-AC5] the flag is cleared once the replacement booking is approved", async ({ page, baseURL }, info) => {
    const flagged = await flaggedEvent(baseURL!, "Clear Fair");
    const replacementId = await replaceVia(flagged.priya, flagged, flagged.spare);
    await signIn(page, PRIYA, /\/queue/);
    await page.getByRole("button", { name: /^Needs a venue/ }).click();
    await expect(page.getByRole("button", { name: new RegExp(flagged.name) })).toBeVisible(); // still flagged while pending

    await confirmVia(flagged.staff, replacementId);
    await page.reload();

    await page.getByRole("button", { name: /^Needs a venue/ }).click();
    await expect(page.getByRole("button", { name: new RegExp(flagged.name) })).toHaveCount(0);
    await openInQueue(page, flagged.name);
    await expect(action(page, "Find a replacement venue")).toHaveCount(0);
    await openVenueTab(page);
    await expect(needsReplacement(page)).toHaveCount(0);
    await expect(bookingRow(page, flagged.original.name)).not.toContainText("Needs a replacement");
    // The released booking is kept, but no longer carries the flag.
    const rows: Array<{ id: number; status: string; flag: unknown }> = await (await flagged.priya.get("/api/bookings")).json();
    expect(rows.find((b) => b.id === flagged.bookingId)).toMatchObject({ status: "cancelled", flag: null });
    await page.getByRole("button", { name: /Notifications/ }).click();
    // Two notices say "Venue booking approved" for this event (the first booking, then the replacement): the replacement's mentions what it replaces.
    const notice = page.locator('[class*="NotificationsPanel_item__"]', { hasText: flagged.name }).filter({ hasText: "It replaces the booking at" });
    await expect(notice).toContainText(`It replaces the booking at ${flagged.original.name}, which has been released and no longer needs alternative arrangements.`);
    observed(info, `While the replacement was pending, ${flagged.name} was still under "Needs a venue". After Venue Staff approved it, the filter no longer listed it, "Find a replacement venue" and the "Bookings needing a replacement venue" section were gone, and Notifications held "Venue booking approved ... It replaces the booking at ${flagged.original.name}, which has been released and no longer needs alternative arrangements."`);
  });

  test("[TC-US40-06] [US40-AC5] a rejected replacement leaves the booking flagged so another venue can be tried", async ({ page, baseURL }, info) => {
    const flagged = await flaggedEvent(baseURL!, "Retry Fair");
    const firstId = await replaceVia(flagged.priya, flagged, flagged.spare);
    await decideVia(flagged.staff, firstId, "rejected", "The spare hall is needed for exams.");

    await signIn(page, PRIYA, /\/queue/);
    await openInQueue(page, flagged.name);
    await openVenueTab(page);

    await expect(needsReplacement(page)).toContainText(flagged.original.name);
    await expect(needsReplacement(page).getByRole("button", { name: "Find a replacement venue" })).toBeVisible(); // free to try another venue
    await expect(bookingRow(page, flagged.original.name)).toContainText("Approved");
    await expect(bookingRow(page, flagged.spare.name)).toContainText("Rejected");
    observed(info, `After Venue Staff rejected the replacement at ${flagged.spare.name}, the booking at ${flagged.original.name} was still Approved and listed under "Bookings needing a replacement venue" with "Find a replacement venue" offered again; the rejected request showed as Rejected.`);
  });

  test("[TC-US40-07] [US40-AC3] an event waiting for its safety check can still replace the flagged booking", async ({ page, baseURL }, info) => {
    const flagged = await flaggedEvent(baseURL!, "Safety Fair");
    // Its venue and equipment were confirmed, so the coordinator had sent it to the safety check before the venue went unavailable.
    await sendToCheck(flagged.priya, flagged.eventId);
    await signIn(page, PRIYA, /\/queue/);
    await openInQueue(page, flagged.name);
    await expect(workspaceStatus(page)).toHaveText("Pending Safety Review");
    await openVenueTab(page);

    await needsReplacement(page).getByRole("button", { name: "Find a replacement venue" }).click();
    await resultCard(page, flagged.spare.name).getByRole("button", { name: "Request booking", exact: true }).click();

    await expect(toast(page)).toContainText(`Replacement requested at ${flagged.spare.name}.`);
    await expect(bookingRow(page, flagged.spare.name)).toContainText(`Replacement for the booking at ${flagged.original.name}`);
    observed(info, `${flagged.name}, Pending Safety Review, offered "Find a replacement venue" on its flagged booking and "Replacement requested at ${flagged.spare.name}." was shown, with the new booking marked as a replacement for the booking at ${flagged.original.name}.`);
  });
});
