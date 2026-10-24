import { expect, test, type APIRequestContext, type Locator, type Page } from "@playwright/test";
import { GRACE, MAYA, PRIYA, SAM, WEI, apiAs, myEventsRow, openInQueue, signIn, toast, unique } from "./support/app";
import { DANIEL, futureDate, observed } from "./support/venues";
import { scenarioNames, seedScenario, type Scenario } from "./support/scenario";

/**
 * US13 — View Event Status (functional).
 * "As an involved user, I want to view the current status of an event and its history so that I
 * know where it stands."
 *
 * Test cases: docs/testing/US13_View_Event_Status_Test_Cases.xlsx (TC-038 to TC-050), run here in a
 * real browser against the functional-test database. The test-data events (tests/functional/support/
 * seed_events.py) are the ones the test cases describe: Annual Research Symposium (Confirmed, after a
 * clarification), Startup Pitch Night (Approved, venue booking pending), Faculty Networking Mixer
 * (Rejected) and a Submitted request nobody has picked up.
 */
const STATUSES = ["Draft", "Submitted", "Under Review", "Pending Clarification", "Approved", "Rejected", "Confirmed", "Cancelled"];

let s: Scenario;
let names: ReturnType<typeof scenarioNames>;
test.beforeAll(() => {
  s = seedScenario(unique("status"));
  names = scenarioNames(s);
});

/** The card (Booking requests, Equipment, Browse events) for the event called `name`. */
const card = (page: Page, name: string) =>
  page.locator(".card").filter({ has: page.getByText(name, { exact: true }) }).filter({ has: page.getByRole("button", { name: /status history/i }) });

/** Opens "Status history" inside `container` and returns its entries, newest first, as their text. */
async function openHistory(container: Locator): Promise<string[]> {
  await container.getByRole("button", { name: /^(Status history|History)$/ }).click();
  const entries = container.locator('ol[aria-label="Status history"] > li');
  await expect(entries.first()).toBeVisible();
  return entries.allInnerTexts();
}

/** On My events: opens the row's History (shown under the row) and returns its entries, newest first. */
async function openRowHistory(page: Page, name: string): Promise<string[]> {
  await myEventsRow(page, name).getByRole("button", { name: "History", exact: true }).click();
  const entries = page.locator('ol[aria-label="Status history"] > li');
  await expect(entries.first()).toBeVisible();
  return entries.allInnerTexts();
}

/** The current status shown above a status history. */
const currentStatus = (container: Locator) =>
  container.getByText("Current status", { exact: true }).locator("xpath=following-sibling::span[contains(@class, 'pill')][1]");

async function history(api: APIRequestContext, id: number) {
  const res = await api.get(`/api/events/${id}/history`);
  expect(res.status(), `GET /events/${id}/history`).toBe(200);
  return res.json();
}

test.describe("US13 - View Event Status", () => {
  test("[TC-038] [US13-AC1] the organiser can view the current status of every event they created", async ({ page }, info) => {
    await signIn(page, MAYA, /\/my-events/);
    for (const [name, status] of [[names.symposium, "Confirmed"], [names.pitch, "Approved"], [names.mixer, "Rejected"], [names.bare, "Submitted"]]) {
      await expect(myEventsRow(page, name).locator(".pill"), name).toHaveText(status);
    }
    // The counters agree with the statuses listed.
    const shown = await page.locator('[class*="MyEventsTable"][class*="row"] .pill').allTextContents();
    const count = (...labels: string[]) => String(shown.filter((x) => labels.includes(x)).length);
    for (const [label, value] of [["Drafts", count("Draft")], ["Awaiting decision", count("Submitted", "Under Review", "Pending Clarification")],
      ["Approved", count("Approved")], ["Confirmed", count("Confirmed")]]) {
      const counter = page.locator(".card").filter({ has: page.getByText(label, { exact: true }) }).locator(".display-number");
      await expect(counter, label).toHaveText(value);
    }
    observed(info, `My events showed ${names.symposium} Confirmed, ${names.pitch} Approved, ${names.mixer} Rejected and ${names.bare} Submitted; the Drafts, Awaiting decision, Approved and Confirmed counters matched the statuses listed.`);
  });

  test("[TC-039] [US13-AC1] the coordinator sees the status of their events; the Lead sees requests awaiting a coordinator", async ({ page }, info) => {
    // US43: requests nobody coordinates yet are the Lead's to see and assign, not every coordinator's.
    await signIn(page, PRIYA, /\/queue/);
    await page.getByRole("button", { name: "All", exact: true }).click();
    await page.getByPlaceholder(/search events/i).fill(s.suffix);
    const row = (name: string) => page.getByRole("button", { name: new RegExp(name) });
    for (const [name, status] of [[names.symposium, "Confirmed"], [names.pitch, "Approved"], [names.mixer, "Rejected"]]) {
      await expect(row(name).locator(".pill"), name).toHaveText(status);
    }
    await expect(row(names.bare)).toHaveCount(0);
    await openInQueue(page, names.pitch);
    await page.getByRole("button", { name: "Activity", exact: true }).click();
    await expect(currentStatus(page.locator("body"))).toHaveText("Approved");

    await page.getByRole("button", { name: "Sign out" }).click();
    await signIn(page, GRACE, /\/assignments/);
    await expect(page.locator(`[aria-label="Unassigned request: ${names.bare}"] .pill`)).toHaveText("Submitted");
    observed(info, `Priya's queue (All) listed the symposium Confirmed, the pitch night Approved and the mixer Rejected, but not the unassigned ${names.bare}; the pitch night's Activity tab showed Current status Approved. The Lead's Assignments page listed ${names.bare} as Submitted.`);
  });

  test("[TC-040] [US13-AC1] venue staff can view the status of an event with a venue booking", async ({ page }, info) => {
    await signIn(page, DANIEL, /\/bookings/);
    const pitch = card(page, names.pitch);
    await expect(pitch).toBeVisible();
    await openHistory(pitch);
    await expect(currentStatus(pitch)).toHaveText("Approved");
    observed(info, `${names.pitch} was listed under Booking requests; its Status history showed Current status Approved.`);
  });

  test("[TC-041] [US13-AC1] technical support can view the status of an event that requests equipment", async ({ page }, info) => {
    await signIn(page, WEI, /\/equipment/);
    await page.getByLabel("Assigned event", { exact: true }).selectOption({ label: names.symposium });
    const symposium = card(page, names.symposium);
    await expect(symposium).toContainText("Projector");
    await expect(symposium).toContainText("× 2");
    await openHistory(symposium);
    await expect(currentStatus(symposium)).toHaveText("Confirmed");
    await expect(card(page, names.pitch)).toHaveCount(0);
    await expect(page.getByRole("option", { name: names.pitch, exact: true })).toHaveCount(0);
    observed(info, `${names.symposium} was listed under Equipment requests (Projector × 2); its Status history showed Current status Confirmed. The pitch night (no equipment) was not listed.`);
  });

  test("[TC-042] [US13-AC1] an attendee can view the status of a confirmed event open for registration", async ({ page }, info) => {
    await signIn(page, SAM, /\/browse/);
    const symposium = card(page, names.symposium);
    await openHistory(symposium);
    await expect(currentStatus(symposium)).toHaveText("Confirmed");
    for (const hidden of [names.pitch, names.mixer, names.bare]) await expect(page.getByText(hidden, { exact: true }), hidden).toHaveCount(0);
    observed(info, `Browse events listed ${names.symposium} (and none of the other scenario events); its Status history showed Current status Confirmed.`);
  });

  test("[TC-043] [US13-AC2] every status shown comes from the defined set", async ({ page }, info) => {
    const seen = new Set<string>();
    const collect = async () => (await page.locator(".pill").allTextContents()).forEach((x) => seen.add(x.trim()));
    await page.goto("/login");
    await expect(page.getByText("Event statuses")).toBeVisible();
    await expect(page.locator("div", { has: page.getByText("Event statuses", { exact: true }) }).getByText(String(STATUSES.length), { exact: true })).toBeVisible();

    for (const [who, landing] of [[MAYA, /\/my-events/], [PRIYA, /\/queue/], [DANIEL, /\/bookings/], [WEI, /\/equipment/], [SAM, /\/browse/]] as const) {
      await signIn(page, who, landing);
      if (who === PRIYA) await page.getByRole("button", { name: "All", exact: true }).click();
      await collect();
      await page.getByRole("button", { name: "Sign out" }).click();
    }
    expect(seen.size).toBeGreaterThan(0);
    for (const label of seen) expect(STATUSES, label).toContain(label);
    observed(info, `The sign-in page counted ${STATUSES.length} event statuses. Statuses shown on My events, Review queue, Booking requests, Equipment and Browse events: ${[...seen].join(", ")}; all are in the defined set.`);
  });

  test("[TC-044] [US13-AC3] saving and submitting a request is recorded in its status history; re-saving a draft is not", async ({ page }, info) => {
    const name = unique("Robotics Club Showcase");
    await signIn(page, MAYA, /\/my-events/);
    await page.getByRole("link", { name: "New request" }).click();
    await page.getByPlaceholder("Alumni Homecoming Dinner").fill(name);
    await page.locator("select.text-input").selectOption("other");
    await page.locator('input[type="date"]').fill(futureDate(53));
    await page.locator('input[type="time"]').nth(0).fill("14:00");
    await page.locator('input[type="time"]').nth(1).fill("17:00");
    await page.getByPlaceholder("180").fill("70");
    await page.getByRole("button", { name: "Save as draft" }).click();
    await expect(toast(page)).toContainText("Draft saved.");

    const row = () => myEventsRow(page, name);
    const entriesFor = async () => {
      await row().getByRole("button", { name: "History" }).click();
      const entries = page.locator('ol[aria-label="Status history"] > li');
      await expect(entries.first()).toBeVisible();
      const texts = await entries.allInnerTexts();
      await row().getByRole("button", { name: "Hide history" }).click();
      return texts;
    };
    const first = await entriesFor();
    expect(first).toHaveLength(1);
    expect(first[0]).toContain("Created as Draft");
    expect(first[0]).toContain(MAYA.name);

    await row().getByRole("button", { name: "Continue" }).click();
    await page.getByRole("button", { name: "Save as draft" }).click();
    await expect(toast(page)).toContainText("Draft saved.");
    expect(await entriesFor()).toHaveLength(1);

    await row().getByRole("button", { name: "Submit" }).click();
    await expect(toast(page)).toContainText(`${name} submitted for review.`);
    const last = await entriesFor();
    expect(last).toHaveLength(2);
    expect(last[0]).toContain("Draft → Submitted");
    expect(last[0]).toContain(MAYA.name);
    expect(last[1]).toContain("Created as Draft");
    await expect(row().locator(".pill")).toHaveText("Submitted");
    observed(info, `After saving, History showed one entry "Created as Draft" by ${MAYA.name}; re-saving the draft left one entry; after submitting, "Draft → Submitted" by ${MAYA.name} was listed above "Created as Draft" and the status was Submitted.`);
  });

  test("[TC-045] [US13-AC3] the full history is shown newest first with who changed it, when, and any reason", async ({ page }, info) => {
    await signIn(page, MAYA, /\/my-events/);
    const entries = await openRowHistory(page, names.symposium);
    const expected = [
      ["Approved → Confirmed", PRIYA.name], ["Under Review → Approved", PRIYA.name], ["Pending Clarification → Under Review", MAYA.name],
      ["Under Review → Pending Clarification", PRIYA.name], ["Submitted → Under Review", PRIYA.name], ["Created as Submitted", MAYA.name],
    ];
    expect(entries).toHaveLength(expected.length);
    expected.forEach(([change, who], i) => {
      expect(entries[i], `entry ${i + 1}`).toContain(change);
      expect(entries[i], `entry ${i + 1}`).toContain(who);
      expect(entries[i], `entry ${i + 1}`).toMatch(/\d{2} \w{3} \d{4}, \d{2}:\d{2}/);
    });
    expect(entries[3]).toContain(`Reason: ${s.clarify}`);
    await expect(currentStatus(page.locator("body"))).toHaveText("Confirmed");
    observed(info, `History for ${names.symposium} showed six entries newest first: ${expected.map(([c]) => c).join(", ")}, each with a date and time and who made it; the Pending Clarification entry showed its reason. Current status Confirmed.`);
  });

  test("[TC-046] [US13-AC3] a rejection is shown in the history with its reason", async ({ page }, info) => {
    await signIn(page, MAYA, /\/my-events/);
    const entries = await openRowHistory(page, names.mixer);
    expect(entries[0]).toContain("Under Review → Rejected");
    expect(entries[0]).toContain(PRIYA.name);
    expect(entries[0]).toContain(`Reason: ${s.reject}`);
    expect(entries.slice(1).map((e) => e.split("\n")[0])).toEqual(["Submitted → Under Review", "Created as Submitted"]);
    await expect(currentStatus(page.locator("body"))).toHaveText("Rejected");
    observed(info, `The newest entry was "Under Review → Rejected" by ${PRIYA.name} with "Reason: ${s.reject}", followed by "Submitted → Under Review" and "Created as Submitted". Current status Rejected.`);
  });

  test("[TC-047] [US13-AC3] every user involved in an event sees the same status history", async ({ baseURL }, info) => {
    const [maya, priya, daniel, wei, sam] = await Promise.all([MAYA, PRIYA, DANIEL, WEI, SAM].map((who) => apiAs(baseURL!, who)));
    const pitch = await history(maya, s.pitch);
    expect(await history(priya, s.pitch)).toEqual(pitch);
    expect(await history(daniel, s.pitch)).toEqual(pitch);
    const symposium = await history(maya, s.symposium);
    expect(await history(wei, s.symposium)).toEqual(symposium);
    expect(await history(sam, s.symposium)).toEqual(symposium);
    observed(info, `The pitch night's ${pitch.length} history entries were identical for the organiser, coordinator and Venue Staff; the symposium's ${symposium.length} entries were identical for the organiser, Technical Support and the attendee.`);
  });

  test("[TC-048] [US13-AC4] users only see the events they are involved in", async ({ baseURL }, info) => {
    const listed = async (who: typeof MAYA) => ((await (await (await apiAs(baseURL!, who)).get("/api/events")).json()) as Array<{ name: string }>).map((e) => e.name);
    const ours = (all: string[]) => [names.symposium, names.pitch, names.mixer, names.bare].filter((n) => all.includes(n));
    expect(ours(await listed(DANIEL))).toEqual([names.symposium, names.pitch]);
    expect(ours(await listed(WEI))).toEqual([names.symposium]);
    expect(ours(await listed(SAM))).toEqual([names.symposium]);
    observed(info, "Of the scenario events, GET /events returned the symposium and pitch night to Venue Staff (both have a venue booking), only the symposium to Technical Support (equipment) and to the attendee (confirmed, registration open).");
  });

  test("[TC-049] [US13-AC4] the status history of an event the user is not involved in can't be opened", async ({ baseURL }, info) => {
    const refused = async (who: typeof MAYA, id: number) => {
      const res = await (await apiAs(baseURL!, who)).get(`/api/events/${id}/history`);
      expect(res.status(), `${who.email} -> ${id}`).toBe(403);
      expect(await res.json()).toEqual({ detail: "You don't have permission to do that" });
    };
    await refused(DANIEL, s.mixer);
    await refused(WEI, s.pitch);
    for (const id of [s.pitch, s.mixer, s.bare]) await refused(SAM, id);
    observed(info, "Venue Staff for the mixer, Technical Support for the pitch night, and the attendee for the pitch night, mixer and submitted request were each refused with 403 \"You don't have permission to do that\".");
  });

  test("[TC-050] [US13-AC4] a signed-out user can't view any event or status history", async ({ page }, info) => {
    await page.goto("/login");
    expect((await page.request.get("/api/events")).status()).toBe(401);
    expect((await page.request.get(`/api/events/${s.symposium}/history`)).status()).toBe(401);
    observed(info, "Signed out, GET /events and GET /events/{symposium}/history both returned 401.");
  });
});
