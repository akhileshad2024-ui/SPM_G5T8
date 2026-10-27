import { expect, test, type Page } from "@playwright/test";
import { GRACE, MAYA, PRIYA, apiAs, assignTo, createRequest, signIn, startReviewVia, unique, workspaceTitle } from "./support/app";
import { observed } from "./support/venues";

/**
 * US36 — Receive Notifications (functional). Week 7 changes CR-W7-5, CR-W7-6.
 * "As a user involved in an event, I want to receive notifications about significant decisions and changes
 * relevant to me so that I know when information changes or action is required."
 *
 * "Given" steps (requests, assignments, decisions) go through the API as the people who make them; the
 * recipient then reads their Notifications in the browser. Test cases: docs/US36-functional-tests.md.
 * AC7 (Safety Officer) is blocked until US44 adds the role.
 */

/** One notification in the open panel: about `event`, with `title`. */
function notice(page: Page, event: string, title: string) {
  return page.locator('[class*="NotificationsPanel_item__"]', { hasText: event }).filter({ hasText: title });
}

function bell(page: Page) {
  return page.getByRole("button", { name: /^Notifications/ });
}

test.describe("US36 - Receive Notifications", () => {
  test("[TC-US36-01] [US36-AC1] [US36-AC2] [US36-AC6] the assigned coordinator is notified, naming the event and what to do", async ({ page, baseURL }, info) => {
    const name = unique("Robotics Showcase");
    await assignTo(await apiAs(baseURL!, GRACE), await createRequest(await apiAs(baseURL!, MAYA), name), PRIYA);

    await signIn(page, PRIYA, /\/queue/);
    await bell(page).click();
    const item = notice(page, name, "Event assigned to you");
    await expect(item).toContainText(`${name}: Grace Ong assigned this event to you.`);
    await expect(item).toContainText("Open it from your queue to start the review.");
    observed(info, `Priya's Notifications held "Event assigned to you" for ${name}: "${await item.innerText()}".`);
  });

  test("[TC-US36-02] [US36-AC3] a notification can be marked read on its own, and stays read", async ({ page, baseURL }, info) => {
    const grace = await apiAs(baseURL!, GRACE);
    const maya = await apiAs(baseURL!, MAYA);
    const first = unique("Design Expo");
    const second = unique("Alumni Talk");
    await assignTo(grace, await createRequest(maya, first), PRIYA);
    await assignTo(grace, await createRequest(maya, second), PRIYA);

    await signIn(page, PRIYA, /\/queue/);
    await bell(page).click();
    await notice(page, first, "Event assigned to you").getByRole("button", { name: "Mark as read" }).click();
    await expect(notice(page, first, "Event assigned to you").getByRole("button", { name: "Mark as read" })).toHaveCount(0);
    await expect(notice(page, second, "Event assigned to you").getByRole("button", { name: "Mark as read" })).toBeVisible();

    await page.reload();
    await bell(page).click();
    await expect(notice(page, first, "Event assigned to you").getByRole("button", { name: "Mark as read" })).toHaveCount(0);
    await expect(notice(page, second, "Event assigned to you").getByRole("button", { name: "Mark as read" })).toBeVisible();
    observed(info, `Priya marked ${first}'s notification read; after a reload it was still read and ${second}'s was still unread.`);
  });

  test("[TC-US36-03] [US36-AC1] the organiser is notified of the decision on their request", async ({ page, baseURL }, info) => {
    const name = unique("Career Fair");
    const eventId = await createRequest(await apiAs(baseURL!, MAYA), name);
    await assignTo(await apiAs(baseURL!, GRACE), eventId, PRIYA);
    const priya = await apiAs(baseURL!, PRIYA);
    await startReviewVia(priya, eventId);
    const res = await priya.post(`/api/events/${eventId}/decision`, { data: { outcome: "rejected", reason: "The hall is booked for exams that week." } });
    expect(res.ok(), await res.text()).toBeTruthy();

    await signIn(page, MAYA, /\/my-events/);
    await bell(page).click();
    const item = notice(page, name, "Event request rejected");
    await expect(item).toContainText("The hall is booked for exams that week.");
    observed(info, `Maya's Notifications held "Event request rejected" for ${name} with the reason: "${await item.innerText()}".`);
  });

  test("[TC-US36-04] [US36-AC4] only the people involved receive a notification", async ({ page, baseURL }, info) => {
    const name = unique("Open House");
    await assignTo(await apiAs(baseURL!, GRACE), await createRequest(await apiAs(baseURL!, MAYA), name), PRIYA);

    // Maya organises the event but was not assigned to it, so "Event assigned to you" is Priya's alone.
    await signIn(page, MAYA, /\/my-events/);
    await bell(page).click();
    await expect(page.locator('[class*="NotificationsPanel_item__"]').filter({ hasText: "Event assigned to you" })).toHaveCount(0);
    observed(info, `Maya's Notifications held no "Event assigned to you" notice for ${name}; only the assigned coordinator gets it.`);
  });

  test("[TC-US36-07] [US36-AC1] a notification opens its event, for the coordinator and the organiser", async ({ page, baseURL }, info) => {
    const name = unique("Hackathon");
    const eventId = await createRequest(await apiAs(baseURL!, MAYA), name);
    await assignTo(await apiAs(baseURL!, GRACE), eventId, PRIYA);
    const priya = await apiAs(baseURL!, PRIYA);
    await startReviewVia(priya, eventId);
    expect((await priya.post(`/api/events/${eventId}/decision`, { data: { outcome: "approved", reason: "" } })).ok()).toBeTruthy();

    // Priya: from her notice to the event in her queue, which stays open even though it is no longer "needs action".
    await signIn(page, PRIYA, /\/queue/);
    await bell(page).click();
    await notice(page, name, "Event assigned to you").getByRole("button", { name: "Open event" }).click();
    await expect(page).toHaveURL(/\/queue$/);
    await expect(workspaceTitle(page, name)).toBeVisible();
    await bell(page).click();
    await expect(notice(page, name, "Event assigned to you").getByRole("button", { name: "Mark as read" })).toHaveCount(0);

    // Maya: from her notice to the event's page in My events.
    await page.goto("about:blank");
    await page.context().clearCookies();
    await signIn(page, MAYA, /\/my-events/);
    await bell(page).click();
    await notice(page, name, "Event request approved").getByRole("button", { name: "Open event" }).click();
    await expect(page).toHaveURL(new RegExp(`/my-events/${eventId}$`));
    observed(info, `Priya's "Open event" opened ${name} in her queue and marked the notice read; Maya's opened /my-events/${eventId}.`);
  });

  test("[TC-US36-08] [US36-AC1] the Lead is told a new request is waiting to be assigned", async ({ page, baseURL }, info) => {
    const name = unique("Coding Bootcamp");
    await createRequest(await apiAs(baseURL!, MAYA), name);

    await signIn(page, GRACE, /\/assignments$/);
    await bell(page).click();
    const item = notice(page, name, "New request to assign");
    await expect(item).toContainText("Assign a coordinator from Assignments.");
    observed(info, `Grace's Notifications held "New request to assign" for ${name}: "${await item.innerText()}".`);
  });

  test("[TC-US36-05] [US36-AC5] a notification arrives within one minute, without reloading", async ({ page, baseURL }, info) => {
    test.setTimeout(120_000);
    await signIn(page, PRIYA, /\/queue/);
    const name = unique("Pitch Night");
    const assignedAt = Date.now();
    await assignTo(await apiAs(baseURL!, GRACE), await createRequest(await apiAs(baseURL!, MAYA), name), PRIYA);

    await bell(page).click();
    await expect(notice(page, name, "Event assigned to you")).toBeVisible({ timeout: 60_000 });
    const seconds = Math.round((Date.now() - assignedAt) / 1000);
    observed(info, `With Priya's page already open, "Event assigned to you" for ${name} appeared ${seconds} s after the assignment, without a reload.`);
  });
});
