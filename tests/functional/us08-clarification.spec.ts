import { expect, test, type Page } from "@playwright/test";
import {
  action, MAYA, PRIYA, apiAs, assignTo, createRequest, myEventsRow, openInQueue, signIn, startReviewVia, submitDialog,
  toast, unique, workspaceStatus,
} from "./support/app";

/**
 * US08 — Request Clarification or Amendments (functional).
 * "As an Event Coordinator, I want to request clarification or amendments from the
 * Event Organiser so that missing or unclear requirements can be resolved."
 *
 * Acceptance criteria: docs/user-stories/event-review-acceptance-criteria.md
 */
const QUESTION = "Can the attendees be split across two rooms?";

/** Given: Maya's request is under review by Priya, and Priya has it open. */
async function reviewing(page: Page, baseURL: string, label: string): Promise<string> {
  const name = unique(label);
  const priya = await apiAs(baseURL, PRIYA);
  const id = await createRequest(await apiAs(baseURL, MAYA), name);
  await assignTo(priya, id, PRIYA);
  await startReviewVia(priya, id);
  await signIn(page, PRIYA, /\/queue/);
  await openInQueue(page, name);
  await expect(workspaceStatus(page)).toHaveText("Under Review");
  return name;
}

test.describe("US08 - Request Clarification or Amendments", () => {
  test("[US08-AC1] [US08-AC3] asking for clarification puts the request on hold and records the question", async ({ page, baseURL }) => {
    const name = await reviewing(page, baseURL!, "Research Symposium");

    // When: Priya sends a clarification request.
    await action(page, "Request clarification").click();
    await submitDialog(page, QUESTION, "Send request");

    // Then: the request is Pending Clarification, with the question shown and saved.
    await expect(toast(page)).toContainText("Clarification request sent to Maya Rahman.");
    await expect(workspaceStatus(page)).toHaveText("Pending Clarification");
    await expect(page.getByText("Clarification request", { exact: true })).toBeVisible();
    await expect(page.getByText(QUESTION)).toBeVisible();
    await page.reload();
    await openInQueue(page, name);
    await expect(workspaceStatus(page)).toHaveText("Pending Clarification");
  });

  test("[US08-AC1] an amendment can be requested instead", async ({ page, baseURL }) => {
    await reviewing(page, baseURL!, "Career Fair");

    await action(page, "Request amendment").click();
    await submitDialog(page, "Please move the start time to 18:00.", "Send request");

    await expect(workspaceStatus(page)).toHaveText("Pending Clarification");
    await expect(page.getByText("Amendment request", { exact: true })).toBeVisible();
  });

  test("[US08-AC2] a clarification request needs a message", async ({ page, baseURL }) => {
    await reviewing(page, baseURL!, "Open House");

    // When: Priya sends the request without writing anything.
    await action(page, "Request clarification").click();
    await submitDialog(page, "", "Send request");

    // Then: it is refused, the dialog stays open, and nothing changes.
    await expect(toast(page)).toContainText("Clarification message is required.");
    await expect(page.locator("textarea.textarea-input")).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(workspaceStatus(page)).toHaveText("Under Review");
  });

  test("[US08-AC4] while waiting for the organiser, the request cannot be approved or rejected", async ({ page, baseURL }) => {
    await reviewing(page, baseURL!, "Sustainability Forum");

    await action(page, "Request clarification").click();
    await submitDialog(page, QUESTION, "Send request");

    await expect(action(page, "Awaiting organiser reply")).toBeVisible();
    await expect(action(page, "Approve")).toHaveCount(0);
    await expect(action(page, "Reject")).toHaveCount(0);
  });

  test("[US08-AC3] the organiser sees their request is pending clarification", async ({ page, baseURL }) => {
    // Given: Priya has asked Maya a question.
    const name = await reviewing(page, baseURL!, "Faculty Workshop");
    await action(page, "Request clarification").click();
    await submitDialog(page, QUESTION, "Send request");
    await expect(workspaceStatus(page)).toHaveText("Pending Clarification");

    // When: Maya opens My Events. (Leave the coordinator's page first: a request still in flight
    // would renew her session cookie after it was cleared.)
    await page.goto("about:blank");
    await page.context().clearCookies();
    await signIn(page, MAYA, /\/my-events/);

    // Then: her request shows Pending Clarification.
    await expect(myEventsRow(page, name).locator(".pill")).toHaveText("Pending Clarification");
  });
});
