import { expect, test } from "@playwright/test";
import {
  action, GRACE, MARCUS, MAYA, PRIYA, apiAs, assignTo, createRequest, myEventsRow, openInQueue, signIn, toast, unique,
  workspaceStatus,
} from "./support/app";

/**
 * US07 — Review Submitted Event Requests (functional).
 * "As an Event Coordinator, I want to review submitted event requests so that I can
 * determine whether their requirements are sufficiently clear."
 *
 * Each test drives the real app in a browser. Acceptance criteria:
 * docs/user-stories/event-review-acceptance-criteria.md
 */
test.describe("US07 - Review Submitted Event Requests", () => {
  test("[US07-AC2] [US07-AC4] a coordinator finds a submitted request and sees what the organiser asked for", async ({ page, baseURL }) => {
    // Given: Maya has submitted a request, and the Lead has assigned it to Priya (US43).
    const name = unique("Alumni Dinner");
    const id = await createRequest(await apiAs(baseURL!, MAYA), name);
    await assignTo(await apiAs(baseURL!, GRACE), id, PRIYA);

    // When: Priya opens it from the review queue.
    await signIn(page, PRIYA, /\/queue/);
    await openInQueue(page, name);

    // Then: it is Submitted and shows the submitted details.
    await expect(workspaceStatus(page)).toHaveText("Submitted");
    await expect(page.getByText("Conference", { exact: true })).toBeVisible();
    await expect(page.getByText("Central campus · capacity 150")).toBeVisible();
    await expect(page.getByText("Functional test request.")).toBeVisible();
  });

  test("[US07-AC2] drafts are never shown in the review queue", async ({ page, baseURL }) => {
    // Given: Maya has only saved her request as a draft.
    const name = unique("Unsent Draft");
    await createRequest(await apiAs(baseURL!, MAYA), name, { submit: false });

    // When: Priya searches the whole queue for it.
    await signIn(page, PRIYA, /\/queue/);
    await page.getByRole("button", { name: "All", exact: true }).click();
    await page.getByPlaceholder(/search events/i).fill(name);

    // Then: it isn't there.
    await expect(page.getByText("No events match this filter.").first()).toBeVisible();
  });

  test("[US07-AC5] requirements that don't add up are flagged for clarification", async ({ page, baseURL }) => {
    // Given: a request expecting more people than the venue capacity it asks for.
    const name = unique("Oversized Gala");
    const id = await createRequest(await apiAs(baseURL!, MAYA), name, { attendance: 200, venueCapacity: 150 });
    await assignTo(await apiAs(baseURL!, GRACE), id, PRIYA);

    // When: Priya opens it.
    await signIn(page, PRIYA, /\/queue/);
    await openInQueue(page, name);

    // Then: the mismatch is pointed out.
    await expect(page.getByText("Worth clarifying")).toBeVisible();
    await expect(page.getByText("Expected attendance (200) is higher than the requested venue capacity (150).")).toBeVisible();
  });

  test("[US07-AC6] starting a review moves the request to Under Review, and it stays that way", async ({ page, baseURL }) => {
    // Given: a submitted request assigned to Priya.
    const name = unique("Design Keynote");
    const id = await createRequest(await apiAs(baseURL!, MAYA), name);
    await assignTo(await apiAs(baseURL!, GRACE), id, PRIYA);

    // When: Priya starts the review.
    await signIn(page, PRIYA, /\/queue/);
    await openInQueue(page, name);
    await action(page, "Start review").click();

    // Then: it is Under Review, the next review actions are offered, and a reload keeps it (saved).
    await expect(toast(page)).toContainText(`Reviewing ${name}.`);
    await expect(workspaceStatus(page)).toHaveText("Under Review");
    await expect(action(page, "Approve")).toBeVisible();
    await page.reload();
    await openInQueue(page, name);
    await expect(workspaceStatus(page)).toHaveText("Under Review");
  });

  test("[US07-AC6] the organiser sees their request is under review", async ({ page, baseURL }) => {
    // Given: Priya has started reviewing Maya's request.
    const name = unique("Pitch Night");
    const maya = await apiAs(baseURL!, MAYA);
    const priya = await apiAs(baseURL!, PRIYA);
    const id = await createRequest(maya, name);
    await assignTo(await apiAs(baseURL!, GRACE), id, PRIYA);
    expect((await priya.post(`/api/events/${id}/review`, { data: {} })).ok()).toBeTruthy();

    // When: Maya opens My Events.
    await signIn(page, MAYA, /\/my-events/);

    // Then: her request shows Under Review.
    await expect(myEventsRow(page, name).locator(".pill")).toHaveText("Under Review");
  });

  test("[US07-AC1] a coordinator does not see an event assigned to another coordinator", async ({ page, baseURL }) => {
    // Given: a request assigned to Priya.
    const name = unique("Priya's Workshop");
    const id = await createRequest(await apiAs(baseURL!, MAYA), name);
    await assignTo(await apiAs(baseURL!, GRACE), id, PRIYA);

    // When: Marcus, another coordinator, searches his queue for it.
    await signIn(page, MARCUS, /\/queue/);
    await page.getByRole("button", { name: "All", exact: true }).click();
    await page.getByPlaceholder(/search events/i).fill(name);

    // Then: it isn't in his queue.
    await expect(page.getByText("No events match this filter.").first()).toBeVisible();
  });
});
