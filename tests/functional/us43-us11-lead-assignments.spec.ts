import { expect, test, type Page } from "@playwright/test";
import { GRACE, MARCUS, MAYA, PRIYA, apiAs, assignTo, createRequest, openInQueue, signIn, toast, unique } from "./support/app";
import { observed } from "./support/venues";

/**
 * US43 — Event Coordinator Lead Oversight, and US11 — Assign Event Coordinator (functional).
 * US43: "As an Event Coordinator Lead, I want to oversee coordinator assignments and active events so
 * that every event request is handled by a suitable coordinator."
 * US11: "As an Event Coordinator Lead, I want to assign an Event Coordinator to a submitted event so that
 * the event has a responsible internal contact."
 *
 * Grace Ong is the Lead (tests/functional/support/seed_users.py). Request names are unique per test,
 * since the Lead's queue also holds other tests' unassigned requests.
 */
const request = (page: Page, name: string) => page.locator(`[aria-label="Unassigned request: ${name}"]`);
const coordinatorCard = (page: Page, name: string) => page.locator(`[aria-label="Coordinator: ${name}"]`);

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

test.describe("US43 - Event Coordinator Lead Oversight", () => {
  test("[TC-US43-01] [US43-AC1] the Lead role exists and sees the unassigned requests", async ({ page, baseURL }, info) => {
    const name = unique("Robotics Showcase");
    await createRequest(await apiAs(baseURL!, MAYA), name);

    await signIn(page, GRACE, /\/assignments$/);
    await expect(page.locator('a[class*="navItem"] [class*="navLabel"]')).toHaveText(["Assignments"]);
    await expect(page.getByText("Event Coordinator Lead", { exact: true })).toBeVisible();  // the sidebar role label, not the sign-in toast
    await expect(request(page, name).locator(".pill")).toHaveText("Submitted");
    observed(info, `Grace Ong signed in as Event Coordinator Lead to /assignments (navigation: Assignments only); the new request "${name}" was listed as Submitted under Unassigned requests.`);
  });

  test("[TC-US43-02] [US43-AC2] the Lead sees each coordinator's current assignments", async ({ page, baseURL }, info) => {
    const maya = await apiAs(baseURL!, MAYA);
    const grace = await apiAs(baseURL!, GRACE);
    const priyas = unique("Priya Workshop");
    const marcuss = unique("Marcus Seminar");
    await assignTo(grace, await createRequest(maya, priyas), PRIYA);
    await assignTo(grace, await createRequest(maya, marcuss), MARCUS);

    await signIn(page, GRACE, /\/assignments$/);
    await expect(coordinatorCard(page, PRIYA.name)).toContainText(priyas);
    await expect(coordinatorCard(page, MARCUS.name)).toContainText(marcuss);
    await expect(coordinatorCard(page, PRIYA.name)).not.toContainText(marcuss);
    await expect(coordinatorCard(page, PRIYA.name).locator("li", { hasText: priyas }).locator(".pill")).toHaveText("Submitted");
    observed(info, `Priya's card listed "${priyas}" (Submitted) and Marcus's card listed "${marcuss}"; neither listed the other's event.`);
  });

  test("[TC-US43-03] [US43-AC3] the Lead sees an unassigned request's basic information before assigning it", async ({ page, baseURL }, info) => {
    const name = unique("Open Day");
    const id = await createRequest(await apiAs(baseURL!, MAYA), name, { attendance: 120 });

    await signIn(page, GRACE, /\/assignments$/);
    const card = request(page, name);
    await expect(card).toContainText(`EVT-${id}`);
    await expect(card).toContainText(MAYA.name);
    await expect(card).toContainText("10:00–12:00");
    await expect(card).toContainText("120 expected");
    await expect(card).toContainText("Functional test request.");
    await card.getByRole("button", { name: "Details", exact: true }).click();
    await expect(card.locator('section[aria-label="Event"]')).toContainText("Conference");
    await expect(card.locator('section[aria-label="People"]')).toContainText("Not yet assigned");
    observed(info, `Before assigning, the card showed EVT-${id}, the organiser, 10:00–12:00, 120 expected and the description; Details showed the event (Conference) and "Not yet assigned".`);
  });

  test("[TC-US43-04] [US43-AC4] coordinators see and manage only the events assigned to them", async ({ page, baseURL }, info) => {
    const maya = await apiAs(baseURL!, MAYA);
    const grace = await apiAs(baseURL!, GRACE);
    const unassigned = unique("Nobody Yet");
    const marcuss = unique("Marcus Only");
    const priyas = unique("Priya Only");
    const unassignedId = await createRequest(maya, unassigned);
    const marcusId = await createRequest(maya, marcuss);
    await assignTo(grace, marcusId, MARCUS);
    await assignTo(grace, await createRequest(maya, priyas), PRIYA);

    await signIn(page, PRIYA, /\/queue$/);
    await page.getByRole("button", { name: "All", exact: true }).click();
    for (const hidden of [unassigned, marcuss]) {
      await page.getByPlaceholder(/search events/i).fill(hidden);
      await expect(page.getByText("No events match this filter.").first(), hidden).toBeVisible();
    }
    await openInQueue(page, priyas);
    await expect(page.getByLabel("Coordinator to assign")).toHaveCount(0);  // coordinators don't assign
    const priya = await apiAs(baseURL!, PRIYA);
    for (const id of [unassignedId, marcusId]) {
      expect((await priya.get(`/api/events/${id}`)).status(), `GET /events/${id}`).toBe(403);
      expect((await priya.post(`/api/events/${id}/review`, { data: {} })).status(), `review ${id}`).toBe(403);
    }
    observed(info, `Priya's review queue (All) didn't list the unassigned request or Marcus's event, but did list her own, with no Assign control. The server refused her (403) when she opened or reviewed the other two.`);
  });

  test("[TC-US43-05] [US43-AC5] every permission check is enforced on the server", async ({ page, baseURL }, info) => {
    const id = await createRequest(await apiAs(baseURL!, MAYA), unique("Server Checked"));
    const coordinators: Array<{ id: number; name: string }> = await (await (await apiAs(baseURL!, GRACE)).get("/api/coordinators")).json();
    const target = coordinators.find((c) => c.name === PRIYA.name)!.id;

    for (const who of [PRIYA, MAYA]) {
      const api = await apiAs(baseURL!, who);
      expect((await api.get("/api/lead/queue")).status(), `${who.email} queue`).toBe(403);
      expect((await api.get("/api/coordinators")).status(), `${who.email} coordinators`).toBe(403);
      expect((await api.post(`/api/events/${id}/assign`, { data: { coordinatorId: target } })).status(), `${who.email} assign`).toBe(403);
    }
    expect((await page.request.get("/api/lead/queue")).status()).toBe(401);

    await signIn(page, PRIYA, /\/queue$/);
    await page.goto("/assignments");
    await expect(page).toHaveURL(/\/queue$/);
    await expect(toast(page)).toContainText("You don't have permission to view that page.");
    observed(info, "A coordinator and an organiser were refused (403) the Lead's queue, the coordinator list and assigning; signed out, the queue was 401. A coordinator opening /assignments was sent back to /queue with the permission message.");
  });
});

test.describe("US11 - Assign Event Coordinator", () => {
  test("[TC-US11-01] [US11-AC1] [US11-AC2] the Lead assigns a coordinator chosen from the eligible staff", async ({ page, baseURL }, info) => {
    const name = unique("Charity Gala");
    await createRequest(await apiAs(baseURL!, MAYA), name);

    await signIn(page, GRACE, /\/assignments$/);
    const card = request(page, name);
    const options = ["Choose a coordinator…", MARCUS.name, PRIYA.name];
    await expect(card.getByLabel("Coordinator to assign").locator("option")).toHaveText(options);  // waits for the coordinators to load
    await expect(card.getByRole("button", { name: "Assign", exact: true })).toBeDisabled();
    await card.getByLabel("Coordinator to assign").selectOption({ label: PRIYA.name });
    await card.getByRole("button", { name: "Assign", exact: true }).click();

    await expect(request(page, name)).toHaveCount(0);
    await expect(coordinatorCard(page, PRIYA.name)).toContainText(name);
    await page.reload();
    await expect(request(page, name)).toHaveCount(0);
    await expect(coordinatorCard(page, PRIYA.name)).toContainText(name);
    observed(info, `The list offered only the coordinators (${options.slice(1).join(", ")}); Assign stayed disabled until one was chosen. After assigning Priya the request left the queue and was listed on her card, also after a reload.`);
  });

  test("[TC-US11-02] [US11-AC3] the assignment is recorded with the assigning user and a timestamp", async ({ page, baseURL }, info) => {
    const name = unique("Alumni Talk");
    const maya = await apiAs(baseURL!, MAYA);
    const id = await createRequest(maya, name);
    const before = Date.now();
    await assignTo(await apiAs(baseURL!, GRACE), id, PRIYA);

    const saved = await (await maya.get(`/api/events/${id}`)).json();
    expect(saved.assignedBy).toBe(GRACE.name);
    expect(Date.parse(saved.assignedAt)).toBeGreaterThanOrEqual(before - 2000);

    await signIn(page, PRIYA, /\/queue$/);
    await openInQueue(page, name);
    await expect(page.getByText(new RegExp(`^Assigned by ${GRACE.name} on \\d{2} \\w{3} \\d{4}, \\d{2}:\\d{2}$`))).toBeVisible();
    observed(info, `The saved event recorded assignedBy "${GRACE.name}" at ${saved.assignedAt}; Priya's Request tab showed "Assigned by ${GRACE.name} on <date, time>".`);
  });

  test("[TC-US11-03] [US11-AC4] the assigned coordinator is notified and given access", async ({ page, baseURL }, info) => {
    const name = unique("Hackathon");
    const id = await createRequest(await apiAs(baseURL!, MAYA), name);
    const priya = await apiAs(baseURL!, PRIYA);
    expect((await priya.get(`/api/events/${id}`)).status()).toBe(403);  // no access before

    await assignTo(await apiAs(baseURL!, GRACE), id, PRIYA);

    expect((await priya.get(`/api/events/${id}`)).status()).toBe(200);
    await signIn(page, PRIYA, /\/queue$/);
    await page.getByRole("button", { name: /Notifications/ }).click();
    await expect(page.locator('[class*="NotificationsPanel_item__"]', { hasText: name })).toContainText("Event assigned to you");
    await page.getByRole("button", { name: /Notifications/ }).click();
    await openInQueue(page, name);
    observed(info, `Before the assignment Priya was refused the event (403); after it she could open it, and her Notifications held "Event assigned to you" for ${name}.`);
  });

  test("[TC-US11-04] [US11-AC5] a user who isn't an Event Coordinator can't be assigned", async ({ baseURL }, info) => {
    const id = await createRequest(await apiAs(baseURL!, MAYA), unique("Wrong Person"));
    const grace = await apiAs(baseURL!, GRACE);
    const maya = await (await apiAs(baseURL!, MAYA)).get("/api/auth/me").then((r) => r.json());

    const res = await grace.post(`/api/events/${id}/assign`, { data: { coordinatorId: maya.id } });

    expect(res.status()).toBe(422);
    expect((await res.json()).detail).toBe(`${MAYA.name} is not an Event Coordinator.`);
    expect(await (await (await apiAs(baseURL!, MAYA)).get(`/api/events/${id}`)).json()).toMatchObject({ coordinator: null });
    observed(info, `Assigning the organiser (${MAYA.name}) was refused with 422 "${MAYA.name} is not an Event Coordinator." and the request stayed unassigned.`);
  });
});
