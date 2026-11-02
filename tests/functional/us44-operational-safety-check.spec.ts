import { expect, test, type Browser } from "@playwright/test";
import { HANNAH, PRIYA, RAVI, action, apiAs, openInQueue, signIn, toast, unique, workspaceStatus } from "./support/app";
import { awaiting, decideVia, openSafetyChecks, readyEvent, reviewArea, reviewed, safetyCard, sendToCheck } from "./support/safety";
import { ALL_DAYS, eventFor, observed } from "./support/venues";

/**
 * US44 — Conduct Operational Safety Check (functional).
 * "As a Safety Officer, I want to review the operational safety of a planned event so that it proceeds to
 * preparation only when its arrangements are safe."
 *
 * The coordinator sends an event whose venue booking is approved to the check; the Safety Officer reviews it and
 * approves, requests changes or rejects it. A rejection is not the end: the event goes back to rework (US45).
 * Confirming a safety-approved event is US14, which is not built, so the tests stop at Safety Approved.
 *
 * Test cases: tests/functional/report/test_cases.py.
 */
const NO_COMMENT = "A comment is required when rejecting or requesting changes.";

/** The coordinator's own browser, signed in and with the event open. */
async function coordinatorOpens(browser: Browser, baseURL: string, name: string) {
  const page = await (await browser.newContext({ baseURL })).newPage();
  await signIn(page, PRIYA, /\/queue/);
  await openInQueue(page, name);
  return page;
}

test.describe("US44 - Conduct Operational Safety Check", () => {
  test("[TC-US44-01] [US44-AC1] a Safety Officer lands on Safety checks and can open no other page", async ({ page }, info) => {
    await signIn(page, HANNAH, /\/safety/);

    await expect(page.getByRole("link", { name: "Safety checks" })).toBeVisible();
    for (const other of ["Review queue", "Booking requests", "Assignments", "Equipment", "Venue catalogue", "My events", "Browse events"]) {
      await expect(page.getByRole("link", { name: other })).toHaveCount(0);
    }
    for (const url of ["/queue", "/bookings", "/assignments", "/equipment"]) {
      await page.goto(url);
      await expect(page, url).toHaveURL(/\/safety$/);
      await expect(toast(page), url).toContainText("You don't have permission to view that page.");
    }
    observed(info, `Signed in as Hannah Lau (Safety Officer), the page opened was Safety checks and the sidebar held only "Safety checks". /queue, /bookings, /assignments and /equipment each returned to /safety with "You don't have permission to view that page."`);
  });

  test("[TC-US44-02] [US44-AC2] an event whose venue is confirmed is sent to the check and then appears for the Safety Officer", async ({ page, browser, baseURL }, info) => {
    const ready = await readyEvent(baseURL!, "Ready Fair");
    const unbooked = unique("Unbooked Fair");
    await eventFor(baseURL!, unbooked); // approved, but no venue yet
    await openSafetyChecks(page);
    await expect(safetyCard(page, ready.name)).toHaveCount(0); // not sent yet, so not theirs to review

    const coordinator = await coordinatorOpens(browser, baseURL!, ready.name);
    await action(coordinator, "Request safety check").click();
    await expect(toast(coordinator)).toContainText("Sent for a safety check. The Safety Officers have been told.");
    await expect(workspaceStatus(coordinator)).toHaveText("Pending Safety Review");
    await openInQueue(coordinator, unbooked);
    await expect(action(coordinator, "Request safety check")).toHaveCount(0); // no confirmed venue: nothing to send
    await expect(action(coordinator, "Find a venue")).toBeVisible();

    await page.reload();
    await expect(safetyCard(awaiting(page), ready.name)).toBeVisible();
    await expect(safetyCard(page, unbooked)).toHaveCount(0);
    observed(info, `${ready.name} (venue booking approved) was not on the Safety checks page until Priya pressed Request safety check ("Sent for a safety check. The Safety Officers have been told.", status Pending Safety Review). It then showed under "Awaiting a safety check". ${unbooked}, with no venue, offered only "Find a venue" and never appeared.`);
  });

  test("[TC-US44-03] [US44-AC3] the Safety Officer reviews attendance, capacity and layout, emergency access, accessibility, equipment, crowd movement and venue restrictions", async ({ page, baseURL }, info) => {
    const ready = await readyEvent(baseURL!, "Crowded Fair", { attendance: 120, acknowledged: true, venue: { cap: 100 } });
    await sendToCheck(ready.priya, ready.eventId);
    // The event also needs Special Physical Seating, which the venue (Wheelchair Access only) does not offer.
    const second = await readyEvent(baseURL!, "Seating Fair", { accessibility: ["Wheelchair Access", "Special Physical Seating"], acknowledged: true });
    await sendToCheck(second.priya, second.eventId);
    await openSafetyChecks(page);

    const crowded = safetyCard(page, ready.name);
    await expect(crowded.getByText("1 concern flagged")).toBeVisible();
    await expect(crowded.locator("section")).toHaveCount(7);
    await expect(reviewArea(crowded, "Expected attendance")).toContainText("120 people are expected.");
    const capacity = reviewArea(crowded, "Venue capacity and layout");
    await expect(capacity).toContainText(`${ready.venueName}: capacity 100; booked for 120 people (120% of capacity) in a theatre layout.`);
    await expect(capacity).toContainText(`${ready.venueName}: 120 people is more than its capacity of 100.`);
    await expect(reviewArea(crowded, "Emergency access")).toContainText("Not recorded");
    await expect(reviewArea(crowded, "Crowd movement")).toContainText("Not recorded");
    await expect(reviewArea(crowded, "Equipment placement")).toContainText("No equipment is requested for this event.");
    await expect(reviewArea(crowded, "Known venue restrictions")).toContainText(
      `${ready.venueName}: open ${ALL_DAYS.join(", ")}, 06:00 - 23:00; 0 min setup before and 0 min turnaround after the event.`);

    const seating = safetyCard(page, second.name);
    const accessibility = reviewArea(seating, "Accessibility requirements");
    await expect(accessibility).toContainText("Needed: Wheelchair Access, Special Physical Seating.");
    await expect(accessibility).toContainText(`${second.venueName} offers: Wheelchair Access.`);
    await expect(accessibility).toContainText(`${second.venueName} does not offer: Special Physical Seating.`);
    observed(info, `${ready.name} (120 people, a 100-seat venue) showed all seven areas, with "120 people is more than its capacity of 100." flagged and "1 concern flagged"; Emergency access and Crowd movement were marked "Not recorded"; equipment said none requested. ${second.name} showed that its venue "does not offer: Special Physical Seating."`);
  });

  test("[TC-US44-04] [US44-AC4] a comment is mandatory to reject or request changes", async ({ page, baseURL }, info) => {
    const ready = await readyEvent(baseURL!, "Comment Fair");
    await sendToCheck(ready.priya, ready.eventId);
    await openSafetyChecks(page);
    const card = safetyCard(page, ready.name);

    await card.getByRole("button", { name: "Reject", exact: true }).click();
    await expect(card.getByText(NO_COMMENT)).toBeVisible();
    await card.getByLabel("Comment").fill("   ");
    await card.getByRole("button", { name: "Request changes", exact: true }).click();
    await expect(card.getByText(NO_COMMENT)).toBeVisible();
    await expect(safetyCard(awaiting(page), ready.name)).toBeVisible(); // nothing was decided

    await card.getByLabel("Comment").fill("The emergency exits are blocked by the stage.");
    await card.getByRole("button", { name: "Reject", exact: true }).click();
    await expect(toast(page)).toContainText("Safety arrangement rejected. The coordinator has been told.");
    await expect(safetyCard(awaiting(page), ready.name)).toHaveCount(0);
    await expect(safetyCard(reviewed(page), ready.name).getByText("Safety Rejected")).toBeVisible();
    observed(info, `Reject and Request changes with no comment (and with only spaces) each showed "${NO_COMMENT}" and left the event under "Awaiting a safety check". With a comment, Reject worked ("Safety arrangement rejected. The coordinator has been told.") and the event moved to Already reviewed as Safety Rejected.`);
  });

  test("[TC-US44-05] [US44-AC4] the officer can approve without a comment, and request changes with one", async ({ page, baseURL }, info) => {
    const approved = await readyEvent(baseURL!, "Approve Fair");
    const changes = await readyEvent(baseURL!, "Changes Fair");
    await sendToCheck(approved.priya, approved.eventId);
    await sendToCheck(changes.priya, changes.eventId);
    await openSafetyChecks(page);

    await safetyCard(page, approved.name).getByRole("button", { name: "Approve", exact: true }).click();
    await expect(toast(page)).toContainText("Safety check approved. The coordinator has been told.");
    await expect(safetyCard(reviewed(page), approved.name).getByText("Safety Approved")).toBeVisible();

    const card = safetyCard(page, changes.name);
    await card.getByLabel("Comment").fill("Widen the aisle between rows.");
    await card.getByRole("button", { name: "Request changes", exact: true }).click();
    await expect(toast(page)).toContainText("Changes requested. The coordinator has been told.");
    await expect(safetyCard(reviewed(page), changes.name).getByText("Safety Changes Requested")).toBeVisible();
    await expect(safetyCard(awaiting(page), approved.name)).toHaveCount(0);
    await expect(safetyCard(awaiting(page), changes.name)).toHaveCount(0);
    observed(info, `${approved.name} was approved with no comment ("Safety check approved. The coordinator has been told.", Safety Approved). ${changes.name} was sent back with the comment "Widen the aisle between rows." ("Changes requested. The coordinator has been told.", Safety Changes Requested).`);
  });

  test("[TC-US44-06] [US44-AC5] the outcome, reviewer and time are recorded and the event's status is updated", async ({ page, browser, baseURL }, info) => {
    const ready = await readyEvent(baseURL!, "Record Fair");
    await sendToCheck(ready.priya, ready.eventId);
    await openSafetyChecks(page);
    const card = safetyCard(page, ready.name);
    await card.getByLabel("Comment").fill("Exits are blocked.");
    await card.getByRole("button", { name: "Reject", exact: true }).click();
    await expect(toast(page)).toContainText("Safety arrangement rejected.");

    // Hannah's record of it: the outcome, who and when, and her comment.
    const history = safetyCard(page, ready.name).locator("li", { hasText: "Exits are blocked." });
    await expect(history).toContainText("Rejected · Hannah Lau ·");
    await expect(history).toContainText(/\d{2} \w{3} \d{4}/);

    // Another officer sees who decided; the coordinator sees the new status and the outcome on the event.
    const ravi = await (await browser.newContext({ baseURL })).newPage();
    await openSafetyChecks(ravi, RAVI);
    await expect(safetyCard(ravi, ready.name).locator("li", { hasText: "Exits are blocked." })).toContainText("Rejected · Hannah Lau ·");
    const coordinator = await coordinatorOpens(browser, baseURL!, ready.name);
    await expect(workspaceStatus(coordinator)).toHaveText("Safety Rejected");
    const outcome = coordinator.locator('[aria-label="Safety check outcome"]');
    await expect(outcome).toContainText("Safety rejected");
    await expect(outcome).toContainText("Hannah Lau");
    await expect(outcome).toContainText("Exits are blocked.");
    observed(info, `After Hannah rejected ${ready.name} with "Exits are blocked.", her record read "Rejected · Hannah Lau · <date and time>" with the comment, Ravi (another officer) saw the same, and Priya's workspace showed the status Safety Rejected and a "Safety rejected" card with Hannah Lau and the comment.`);
  });

  test("[TC-US44-07] [US44-AC2] [US44-AC6] the Safety Officers are told when an event is ready and the coordinator when it is decided", async ({ page, browser, baseURL }, info) => {
    const ready = await readyEvent(baseURL!, "Notify Fair");
    await sendToCheck(ready.priya, ready.eventId);
    await decideVia(await apiAs(baseURL!, HANNAH), ready.eventId, "changes_requested", "Widen the aisle between rows.");

    // Both officers were told it was ready.
    for (const who of [HANNAH, RAVI]) {
      const officerPage = await (await browser.newContext({ baseURL })).newPage();
      await signIn(officerPage, who, /\/safety/);
      await officerPage.getByRole("button", { name: /Notifications/ }).click();
      const ready_notice = officerPage.locator('[class*="NotificationsPanel_item__"]', { hasText: ready.name }).filter({ hasText: "Safety check needed" });
      await expect(ready_notice).toContainText("is ready for its Operational Safety Check");
    }

    // The coordinator was told the outcome, with the comment.
    await signIn(page, PRIYA, /\/queue/);
    await page.getByRole("button", { name: /Notifications/ }).click();
    const notice = page.locator('[class*="NotificationsPanel_item__"]', { hasText: ready.name }).filter({ hasText: "Safety changes requested" });
    await expect(notice).toContainText("needs changes before it passes its Operational Safety Check");
    await expect(notice).toContainText("Comment: Widen the aisle between rows.");
    observed(info, `Hannah and Ravi each had "Safety check needed" for ${ready.name} ("... is ready for its Operational Safety Check"). After Hannah requested changes, Priya's Notifications held "Safety changes requested" saying it needs changes, with "Comment: Widen the aisle between rows."`);
  });

  test("[TC-US44-08] [US44-AC7] a rejected safety arrangement returns the event to rework instead of ending it", async ({ page, browser, baseURL }, info) => {
    const ready = await readyEvent(baseURL!, "Rework Fair");
    await sendToCheck(ready.priya, ready.eventId);
    await decideVia(await apiAs(baseURL!, HANNAH), ready.eventId, "rejected", "Exits are blocked.");

    await signIn(page, PRIYA, /\/queue/);
    await openInQueue(page, ready.name);
    await expect(workspaceStatus(page)).toHaveText("Safety Rejected"); // not "Rejected": the event is not closed
    await expect(page.getByText("This event is not closed. Rework the arrangements (US45), then request the safety check again.")).toBeVisible();
    await action(page, "Request safety check again").click();
    await expect(toast(page)).toContainText("Sent for a safety check.");
    await expect(workspaceStatus(page)).toHaveText("Pending Safety Review");

    const officer = await (await browser.newContext({ baseURL })).newPage();
    await openSafetyChecks(officer, RAVI);
    const card = safetyCard(officer, ready.name);
    await expect(card.locator("li", { hasText: "Exits are blocked." })).toContainText("Rejected · Hannah Lau ·"); // the first round is kept
    await card.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(toast(officer)).toContainText("Safety check approved.");

    await page.reload();
    await openInQueue(page, ready.name);
    await expect(workspaceStatus(page)).toHaveText("Safety Approved");
    observed(info, `After Hannah rejected ${ready.name}, Priya's workspace showed the status Safety Rejected (not Rejected) and "This event is not closed ...". Request safety check again sent it back (Pending Safety Review); Ravi saw the first round's rejection kept in the history, approved it, and the event became Safety Approved.`);
  });
});
