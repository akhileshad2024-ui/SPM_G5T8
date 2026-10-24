import { expect, test, type Page } from "@playwright/test";
import { ALEX, GRACE, MAYA, PRIYA, SAM, WEI, apiAs, assignTo, createRequest, signIn, toast, unique } from "./support/app";
import { DANIEL, catalogueCard, createVenue, observed } from "./support/venues";
import { scenarioNames, seedScenario, sql } from "./support/scenario";

/**
 * US02 — Role-Based Access Control (functional).
 * "As a system, I want to restrict access based on user roles so that users can only access
 * information and functions relevant to their responsibilities."
 *
 * Test cases: docs/testing/US02_RBAC_Test_Cases.xlsx (TC-013 to TC-024), run here in a real browser
 * against the functional-test database. The navigation in TC-016 is today's (US29-US32 added
 * "Event registrations", US20 added "Venues" for coordinators).
 */
const NO_PAGE = "You don't have permission to view that page.";
const NO_ACTION = "You don't have permission to do that";
const ROLE_CHANGE = { email: "rolechange.test@connectsphere.edu", name: "Role Change Test" };

/** The sidebar's page links, in order. */
const navLinks = (page: Page) => page.locator('a[class*="navItem"] [class*="navLabel"]').allTextContents();

/** On the review queue: whether `name` is listed under All. */
async function queueLists(page: Page, name: string): Promise<boolean> {
  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.getByPlaceholder(/search events/i).fill(name);
  return (await page.getByRole("button", { name: new RegExp(name) }).count()) > 0;
}

test.describe("US02 - Role-Based Access Control", () => {
  test("[TC-013] [US02-AC1] an organiser sees only the events they organise", async ({ page, baseURL }, info) => {
    const mine = unique("Maya Own Event");
    const theirs = unique("Alex Own Event");
    await createRequest(await apiAs(baseURL!, MAYA), mine);
    await createRequest(await apiAs(baseURL!, ALEX), theirs);

    await signIn(page, MAYA, /\/my-events/);
    await expect(page.getByText(mine, { exact: true })).toBeVisible();
    await expect(page.getByText(theirs, { exact: true })).toHaveCount(0);
    observed(info, `Maya's My events listed "${mine}" and not Alex Chen's "${theirs}".`);
  });

  test("[TC-014] [US02-AC1] an attendee sees only confirmed events open for registration", async ({ page }, info) => {
    const names = scenarioNames(seedScenario(unique("rbac")));
    await signIn(page, SAM, /\/browse/);
    await expect(page.getByText(names.symposium, { exact: true })).toBeVisible();
    for (const hidden of [names.pitch, names.mixer, names.bare]) await expect(page.getByText(hidden, { exact: true }), hidden).toHaveCount(0);
    observed(info, `Browse events listed the Confirmed "${names.symposium}" and none of the Approved, Rejected or Submitted events.`);
  });

  test("[TC-015] [US02-AC1] a coordinator cannot see organisers' unsubmitted drafts", async ({ page, baseURL }, info) => {
    const maya = await apiAs(baseURL!, MAYA);
    const draft = unique("Postgrad Mixer Draft");
    const submitted = unique("Submitted Request");
    await createRequest(maya, draft, { submit: false });
    await assignTo(await apiAs(baseURL!, GRACE), await createRequest(maya, submitted), PRIYA);  // the Lead assigns Priya (US43)

    await signIn(page, PRIYA, /\/queue/);
    expect(await queueLists(page, submitted)).toBe(true);
    expect(await queueLists(page, draft)).toBe(false);
    observed(info, `Review queue (All) listed the submitted "${submitted}" and not the draft "${draft}".`);
  });

  test("[TC-016] [US02-AC2] each role's navigation shows only the pages for that role", async ({ page }, info) => {
    const expected = [
      [MAYA, /\/my-events/, ["My events", "New request", "Event registrations"]],
      [PRIYA, /\/queue/, ["Review queue", "Pipeline", "Venues", "Event registrations"]],
      [DANIEL, /\/bookings/, ["Booking requests", "Venue catalogue"]],
      [WEI, /\/equipment/, ["Equipment"]],
      [SAM, /\/browse/, ["Browse events"]],
      [GRACE, /\/assignments/, ["Assignments"]],
    ] as const;
    const seen: string[] = [];
    for (const [who, landing, links] of expected) {
      await signIn(page, who, landing);
      expect(await navLinks(page), who.email).toEqual(links);
      seen.push(`${who.email}: ${links.join(", ")}`);
      await page.getByRole("button", { name: "Sign out" }).click();
      await expect(page).toHaveURL(/\/login$/);
    }
    observed(info, seen.join("; "));
  });

  test("[TC-017] [US02-AC3] a user cannot open another role's page by typing its URL", async ({ page }, info) => {
    await signIn(page, MAYA, /\/my-events/);
    for (const url of ["/queue", "/catalogue", "/equipment"]) {
      await page.goto(url);
      await expect(page, url).toHaveURL(/\/my-events$/);
      await expect(toast(page), url).toContainText(NO_PAGE);
    }
    observed(info, `As the organiser, /queue, /catalogue and /equipment each returned to /my-events with "${NO_PAGE}".`);
  });

  test("[TC-018] [US02-AC1] a signed-out user cannot open any protected page", async ({ page }, info) => {
    for (const url of ["/my-events", "/queue", "/catalogue"]) {
      await page.goto(url);
      await expect(page, url).toHaveURL(/\/login$/);
    }
    await expect(page.getByText("Venue Catalogue")).toHaveCount(0);
    observed(info, "Signed out, /my-events, /queue and /catalogue each went to /login without showing event or venue data.");
  });

  test("[TC-019] [US02-AC2] venue staff can perform a permitted action (edit a venue)", async ({ page, baseURL }, info) => {
    const staff = await apiAs(baseURL!, DANIEL);
    const venue = await createVenue(staff, { cap: 50 });
    await signIn(page, DANIEL, /\/bookings/);
    await page.goto("/catalogue");
    await catalogueCard(page, venue.name).getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Capacity").fill("51");
    await page.getByRole("button", { name: "Save Venue" }).click();
    await expect(toast(page)).toContainText(`${venue.name} updated.`);
    await page.reload();
    await expect(catalogueCard(page, venue.name).getByText("51", { exact: true })).toBeVisible();
    expect((await (await staff.get(`/api/venues/${venue.id}`)).json()).cap).toBe(51);
    observed(info, `Venue Staff changed ${venue.name}'s capacity 50 -> 51; after a reload the card and the server both had 51.`);
  });

  test("[TC-020] [US02-AC4] the server refuses to create a venue for a role that isn't Venue Staff", async ({ baseURL }, info) => {
    const name = unique("RBAC Test Room");
    const res = await (await apiAs(baseURL!, MAYA)).post("/api/venues", {
      data: { name, location: "Test", cap: 10, setupMinutes: 0, turnaroundMinutes: 0 },
    });
    expect(res.status()).toBe(403);
    expect((await res.json()).detail).toBe(NO_ACTION);
    const venues: Array<{ name: string }> = await (await (await apiAs(baseURL!, DANIEL)).get("/api/venues?include_inactive=true")).json();
    expect(venues.some((v) => v.name === name)).toBe(false);
    observed(info, `POST /venues as the organiser returned 403 "${NO_ACTION}"; no venue called "${name}" exists.`);
  });

  test("[TC-021] [US02-AC4] the server refuses to deactivate a venue for a role that isn't Venue Staff", async ({ baseURL }, info) => {
    const staff = await apiAs(baseURL!, DANIEL);
    const venue = await createVenue(staff);
    const res = await (await apiAs(baseURL!, WEI)).put(`/api/venues/${venue.id}`, { data: { is_active: false } });
    expect(res.status()).toBe(403);
    expect((await res.json()).detail).toBe(NO_ACTION);
    expect((await (await staff.get(`/api/venues/${venue.id}`)).json()).is_active).toBe(true);
    observed(info, `PUT /venues/${venue.id} {is_active: false} as Technical Support returned 403 "${NO_ACTION}"; the venue stayed active.`);
  });

  test("[TC-022] [US02-AC4] the server refuses data requests without a signed-in session", async ({ page }, info) => {
    await page.goto("/login");
    const res = await page.request.get("/api/venues");
    expect(res.status()).toBe(401);
    expect(await res.json()).toEqual({ detail: "Not signed in" });
    observed(info, 'GET /venues while signed out returned 401 {"detail": "Not signed in"} and no venue data.');
  });

  test("[TC-023] [US02-AC3] a user whose role changes mid-session gets an authorisation error on their next action", async ({ page, baseURL }, info) => {
    const venue = await createVenue(await apiAs(baseURL!, DANIEL), { cap: 50 });
    await signIn(page, ROLE_CHANGE, /\/bookings/);
    await page.goto("/catalogue");
    await catalogueCard(page, venue.name).getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Capacity").fill("75");

    sql("UPDATE users SET role = 'organiser' WHERE email = ?", [ROLE_CHANGE.email]);
    try {
      await page.getByRole("button", { name: "Save Venue" }).click();
      await expect(toast(page)).toContainText(`${NO_ACTION}.`);
    } finally {
      sql("UPDATE users SET role = 'venue' WHERE email = ?", [ROLE_CHANGE.email]);
    }
    expect(await (await (await apiAs(baseURL!, DANIEL)).get(`/api/venues/${venue.id}`)).json()).toMatchObject({ cap: 50 });
    observed(info, `With the account's role changed to organiser while the edit form was open, Save Venue showed "${NO_ACTION}." and the capacity stayed 50. The role was restored afterwards.`);
  });

  test("[TC-024] [US02-AC4] event data and event actions are protected by the server, not only the interface", async ({ baseURL }, info) => {
    const s = seedScenario(unique("rbac"));
    const names = scenarioNames(s);
    const draft = unique("Private Draft");
    const draftId = await createRequest(await apiAs(baseURL!, MAYA), draft, { submit: false });
    const sam = await apiAs(baseURL!, SAM);

    const listed: Array<{ name: string }> = await (await sam.get("/api/events")).json();
    const listedNames = listed.map((e) => e.name);
    expect(listedNames).toContain(names.symposium);
    for (const hidden of [draft, names.pitch, names.mixer, names.bare]) expect(listedNames, hidden).not.toContain(hidden);
    for (const id of [draftId, s.pitch, s.mixer, s.bare]) expect((await sam.get(`/api/events/${id}`)).status(), `GET /events/${id}`).toBe(403);
    const decide = await sam.post(`/api/events/${s.bare}/decision`, { data: { outcome: "approved", reason: "" } });
    expect(decide.status()).toBe(403);
    observed(info, `As the attendee, GET /events returned "${names.symposium}" but not the draft or the unpublished events; GET /events/{id} for each of those returned 403, and approving one (POST /events/{id}/decision) returned 403.`);
  });
});
