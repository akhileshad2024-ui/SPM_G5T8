import { expect, test, type Page } from "@playwright/test";
import {
  action, GRACE, MAYA, PRIYA, apiAs, assignTo, createRequest, myEventsRow, openInQueue, signIn, startReviewVia, submitDialog,
  toast, unique, workspaceStatus,
} from "./support/app";

/**
 * US10 — Approve or Reject Event Request (functional).
 * "As an Event Coordinator, I want to approve or reject an event request and record
 * the decision so that the relevant users know the outcome."
 *
 * Acceptance criteria: docs/user-stories/event-review-acceptance-criteria.md
 */
const REASON = "No venue can hold this attendance on the proposed date.";

/** Given: Maya's request is under review by Priya, and Priya has it open. */
async function reviewing(page: Page, baseURL: string, label: string): Promise<string> {
  const name = unique(label);
  const priya = await apiAs(baseURL, PRIYA);
  const id = await createRequest(await apiAs(baseURL, MAYA), name);
  await assignTo(await apiAs(baseURL, GRACE), id, PRIYA);
  await startReviewVia(priya, id);
  await signIn(page, PRIYA, /\/queue/);
  await openInQueue(page, name);
  await expect(workspaceStatus(page)).toHaveText("Under Review");
  return name;
}

/** Signs out and opens My Events as Maya. */
async function asOrganiser(page: Page) {
  // Leave the coordinator's page first: a request still in flight would renew her session cookie after it was cleared.
  await page.goto("about:blank");
  await page.context().clearCookies();
  await signIn(page, MAYA, /\/my-events/);
}

test.describe("US10 - Approve or Reject Event Request", () => {
  test("[US10-AC1] [US10-AC3] approving with a note records the decision", async ({ page, baseURL }) => {
    const name = await reviewing(page, baseURL!, "Homecoming Dinner");

    // When: Priya approves with a note.
    await action(page, "Approve").click();
    await submitDialog(page, "Venue options to follow this week.", "Approve request");

    // Then: it is Approved, the decision and note are shown, and they survive a reload.
    await expect(toast(page)).toContainText(`${name} approved.`);
    await expect(workspaceStatus(page)).toHaveText("Approved");
    await page.reload();
    await openInQueue(page, name);
    await page.getByRole("button", { name: "Request", exact: true }).click();
    await expect(workspaceStatus(page)).toHaveText("Approved");
    await expect(page.getByText("Venue options to follow this week.")).toBeVisible();
  });

  test("[US10-AC1] the approval note is optional", async ({ page, baseURL }) => {
    await reviewing(page, baseURL!, "Startup Pitch");

    await action(page, "Approve").click();
    await submitDialog(page, "", "Approve request");

    await expect(workspaceStatus(page)).toHaveText("Approved");
  });

  test("[US10-AC2] a rejection needs a reason of at least 10 characters", async ({ page, baseURL }) => {
    await reviewing(page, baseURL!, "Gaming Night");

    // When: Priya tries to reject with a reason that is too short.
    await action(page, "Reject").click();
    await submitDialog(page, "No room", "Reject request");

    // Then: it is refused and the request stays under review.
    await expect(toast(page)).toContainText("Rejection reason must be at least 10 characters.");
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(workspaceStatus(page)).toHaveText("Under Review");
  });

  test("[US10-AC2] [US10-AC4] rejecting with a reason lets the organiser see why", async ({ page, baseURL }) => {
    const name = await reviewing(page, baseURL!, "Rooftop Party");

    // When: Priya rejects it with a reason.
    await action(page, "Reject").click();
    await submitDialog(page, REASON, "Reject request");
    await expect(workspaceStatus(page)).toHaveText("Rejected");

    // Then: Maya sees it Rejected and can read the reason.
    await asOrganiser(page);
    const row = myEventsRow(page, name);
    await expect(row.locator(".pill")).toHaveText("Rejected");
    await row.getByRole("button", { name: "View reason" }).click();
    await expect(toast(page)).toContainText(REASON);
  });

  test("[US10-AC4] the organiser sees an approved request", async ({ page, baseURL }) => {
    const name = await reviewing(page, baseURL!, "Science Fair");
    await action(page, "Approve").click();
    await submitDialog(page, "", "Approve request");
    await expect(workspaceStatus(page)).toHaveText("Approved");

    await asOrganiser(page);

    await expect(myEventsRow(page, name).locator(".pill")).toHaveText("Approved");
  });

  test("[US10-AC6] a decided request offers no further decision", async ({ page, baseURL }) => {
    const name = await reviewing(page, baseURL!, "Charity Run");
    await action(page, "Reject").click();
    await submitDialog(page, REASON, "Reject request");
    await expect(workspaceStatus(page)).toHaveText("Rejected");

    await page.reload();
    await openInQueue(page, name);

    await expect(action(page, "Approve")).toHaveCount(0);
    await expect(action(page, "Reject")).toHaveCount(0);
    await expect(action(page, "Start review")).toHaveCount(0);
  });
});
