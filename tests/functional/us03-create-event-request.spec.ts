import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { MAYA, SAM, apiAs, myEventsRow, signIn, toast, unique } from "./support/app";
import { futureDate, observed } from "./support/venues";

/**
 * US03 — Create Event Request (functional).
 * "As an Event Organiser, I want to create an event request with event details, venue requirements,
 * equipment needs and registration requirements so that the request can be reviewed."
 *
 * Test cases: docs/testing/US03_Create_Event_Request_Test_Cases.xlsx (TC-025 to TC-037), run here in a
 * real browser against the functional-test database.
 *
 * KNOWN DEFECT (TC-029 to TC-034): since US04-US06 moved the wizard to POST /event-requests/submit
 * (13 Oct 2026), nothing checks the request before it is submitted: the wizard no longer calls
 * validateEventRequest (lib/events/request/validation.ts) and that endpoint doesn't run
 * schemas.submission_errors. An empty or invalid request is accepted. Those tests check the required
 * behaviour and are marked test.fail(); once the defect is fixed Playwright reports them as passing
 * unexpectedly, and the marks should be removed.
 */
const DEFECT = "Known defect: requests are submitted without validation since US04-US06 (see the note at the top of this file).";

const BASICS = { description: "Eight student ventures pitch to investors", type: "networking", start: "18:30", end: "21:00", pax: "95" };

// The wizard's inputs have visible labels but aren't linked to them, so they are found by placeholder or type.
const nameBox = (page: Page) => page.getByPlaceholder("Alumni Homecoming Dinner");
const descriptionBox = (page: Page) => page.getByPlaceholder("What is this event for, and who is it for?");
const typeSelect = (page: Page) => page.locator("select.text-input");
const dateBox = (page: Page) => page.locator('input[type="date"]').first();
const startBox = (page: Page) => page.locator('input[type="time"]').nth(0);
const endBox = (page: Page) => page.locator('input[type="time"]').nth(1);
const paxBox = (page: Page) => page.getByPlaceholder("180");
const locationBox = (page: Page) => page.getByPlaceholder("Main campus");
const capacityBox = (page: Page) => page.getByPlaceholder("180");
const chip = (page: Page, label: string) => page.getByRole("button", { name: label, exact: true });
const equipmentRow = (page: Page, name: string) => page.locator('[class*="equipmentItem"]', { hasText: name });
const registrationBox = (page: Page) => page.getByRole("checkbox");
const regCapBox = (page: Page) => page.locator('input[type="number"]').first();
const regCloseBox = (page: Page) => page.locator('input[type="date"]').first();
/** A value in the step 3 Summary: the element right after its label. */
const summary = (page: Page, item: string) => page.getByText(item, { exact: true }).locator("xpath=following-sibling::div[1]");
const outstanding = (page: Page) => page.getByRole("alert").filter({ hasText: "Outstanding mandatory fields" });

async function openNewRequest(page: Page) {
  await signIn(page, MAYA, /\/my-events/);
  await page.getByRole("link", { name: "New request" }).click();
  await expect(nameBox(page)).toBeVisible();
}

async function fillBasics(page: Page, name: string, date: string, overrides: Partial<typeof BASICS> = {}) {
  const b = { ...BASICS, ...overrides };
  await nameBox(page).fill(name);
  await descriptionBox(page).fill(b.description);
  await typeSelect(page).selectOption(b.type);
  await dateBox(page).fill(date);
  await startBox(page).fill(b.start);
  await endBox(page).fill(b.end);
  await paxBox(page).fill(b.pax);
}

async function fillVenue(page: Page, location = "Central campus", capacity = "120") {
  await locationBox(page).fill(location);
  await capacityBox(page).fill(capacity);
  await chip(page, "Standing").click();
}

const next = (page: Page) => page.getByRole("button", { name: "Continue" }).click();
const submit = (page: Page) => page.getByRole("button", { name: "Submit for review" }).click();

/** The names of Maya's saved events called `name` (GET /events). */
async function saved(maya: APIRequestContext, name: string) {
  const events: Array<{ name: string; status: string; purpose: string }> = await (await maya.get("/api/events")).json();
  return events.filter((e) => e.name === name);
}

/** Steps 1-3 with valid values, ready to submit. */
async function completeRequest(page: Page, name: string, date: string) {
  await fillBasics(page, name, date);
  await next(page);
  await fillVenue(page);
  await next(page);
}

test.describe("US03 - Create Event Request", () => {
  test("[TC-025] [US03-AC1] the organiser can enter all event details", async ({ page }, info) => {
    const name = unique("Startup Pitch Night");
    const date = futureDate(30);
    await openNewRequest(page);
    await fillBasics(page, name, date);
    await next(page);
    await expect(page.getByText("Preferred venue location")).toBeVisible();
    await page.getByRole("button", { name: "Back" }).click();
    await expect(nameBox(page)).toHaveValue(name);
    await expect(descriptionBox(page)).toHaveValue(BASICS.description);
    await expect(typeSelect(page)).toHaveValue(BASICS.type);
    await expect(dateBox(page)).toHaveValue(date);
    await expect(startBox(page)).toHaveValue(BASICS.start);
    await expect(endBox(page)).toHaveValue(BASICS.end);
    await expect(paxBox(page)).toHaveValue(BASICS.pax);
    observed(info, `Name, description, type Networking, ${date}, 18:30-21:00 and 95 attendees were accepted; Continue opened step 2 and Back showed the same values.`);
  });

  test("[TC-026] [US03-AC2] the organiser can specify venue location, capacity, layout, accessibility and facilities", async ({ page }, info) => {
    await openNewRequest(page);
    await fillBasics(page, unique("Venue Needs"), futureDate(30));
    await next(page);
    await fillVenue(page);
    // A new request starts with PA system and Wheelchair Access already selected; select only what isn't.
    for (const label of ["PA system", "Projector", "Wheelchair Access"]) {
      if (!/chipOn/.test((await chip(page, label).getAttribute("class")) ?? "")) await chip(page, label).click();
      await expect(chip(page, label), label).toHaveClass(/chipOn/);
    }
    await next(page);
    await expect(summary(page, "Venue")).toContainText("Central campus · capacity 120");
    await expect(summary(page, "Layout")).toContainText("Standing");
    await expect(summary(page, "Facilities")).toContainText("PA system, Projector");
    await expect(summary(page, "Accessibility")).toContainText("Wheelchair Access");
    observed(info, 'The step 3 summary showed Venue "Central campus · capacity 120", Layout Standing, Facilities "PA system, Projector" and Accessibility "Wheelchair Access".');
  });

  test("[TC-027] [US03-AC3] the organiser can specify equipment type, quantity and technical requirements", async ({ page }, info) => {
    await openNewRequest(page);
    await fillBasics(page, unique("Equipment Needs"), futureDate(30));
    await next(page);
    const mic = equipmentRow(page, "Wireless microphone");
    await mic.getByRole("button", { name: "+" }).click();
    await mic.getByRole("button", { name: "+" }).click();
    await expect(mic.locator('[class*="stepperValue"]')).toHaveText("2");
    await mic.getByPlaceholder("Connections, setup, compatibility or power needs").fill("HDMI to stage, spare batteries");
    await fillVenue(page);
    await next(page);
    await expect(summary(page, "Equipment")).toContainText("2 × Wireless microphone");
    observed(info, 'The quantity showed 2, a technical-requirements box appeared for the microphone, and the summary showed "2 × Wireless microphone".');
  });

  test("[TC-028] [US03-AC4] the organiser can set registration needed, capacity limit and closing date", async ({ page }, info) => {
    await openNewRequest(page);
    await completeRequest(page, unique("Registration Needs"), futureDate(30));
    await registrationBox(page).check();
    await regCapBox(page).fill("120");
    await regCloseBox(page).fill(futureDate(20));
    await expect(summary(page, "Registration")).toContainText("Enabled · cap 120");
    await registrationBox(page).uncheck();
    await expect(page.getByText("Registration cap")).toHaveCount(0);
    await expect(summary(page, "Registration")).toContainText("Not enabled");
    observed(info, 'Ticking registration showed the cap and closing-date fields and the summary "Enabled · cap 120"; unticking hid them and the summary showed "Not enabled".');
  });

  test("[TC-029] [US03-AC5] missing mandatory event details are reported and the request isn't submitted", async ({ page, baseURL }) => {
    test.fail(true, DEFECT);
    await openNewRequest(page);
    await next(page);
    await next(page);
    await submit(page);
    for (const message of ["Event name is required.", "Event description is required.", "Event type is required.", "Preferred date is required.",
      "Expected attendance must be a positive whole number."]) {
      await expect(outstanding(page), message).toContainText(message);
    }
    await expect(page).toHaveURL(/\/new-request$/);
    expect(await saved(await apiAs(baseURL!, MAYA), "")).toHaveLength(0);
  });

  test("[TC-030] [US03-AC5] missing venue and equipment details are reported", async ({ page }) => {
    test.fail(true, DEFECT);
    await openNewRequest(page);
    await fillBasics(page, unique("Missing Venue"), futureDate(30));
    await next(page);
    await equipmentRow(page, "Projector").getByRole("button", { name: "+" }).click();
    await next(page);
    await submit(page);
    for (const message of ["Venue location is required.", "Venue capacity must be a positive whole number.", "Equipment technical requirements are required."]) {
      await expect(outstanding(page), message).toContainText(message);
    }
    await expect(page).toHaveURL(/\/new-request$/);
  });

  test("[TC-031] [US03-AC5] missing registration details are reported", async ({ page }) => {
    test.fail(true, DEFECT);
    await openNewRequest(page);
    await completeRequest(page, unique("Missing Registration"), futureDate(30));
    await registrationBox(page).check();
    await regCapBox(page).fill("");
    await submit(page);
    await expect(page.getByText("Registration capacity must be a positive whole number.").first()).toBeVisible();
    await expect(page.getByText("Registration closing date is required.").first()).toBeVisible();
    await expect(page).toHaveURL(/\/new-request$/);
  });

  test("[TC-032] [US03-AC5] invalid values are rejected", async ({ page }) => {
    test.fail(true, DEFECT);
    await openNewRequest(page);
    await fillBasics(page, unique("Invalid Values"), futureDate(30), { start: "18:30", end: "17:00", pax: "0" });
    await next(page);
    await fillVenue(page);
    await next(page);
    await submit(page);
    await expect(outstanding(page)).toContainText("Expected attendance must be a positive whole number.");
    await expect(outstanding(page)).toContainText("End time must be later than start time.");
    await expect(page).toHaveURL(/\/new-request$/);
  });

  test("[TC-033] [US03-AC6] an event date in the past cannot be entered", async ({ page }) => {
    test.fail(true, DEFECT);
    await openNewRequest(page);
    // The picker only offers today onwards.
    await expect(dateBox(page)).toHaveAttribute("min", futureDate(0));
    await completeRequest(page, unique("Past Date"), futureDate(-1));
    await submit(page);
    await expect(outstanding(page)).toContainText("Preferred date cannot be in the past.");
    await expect(page).toHaveURL(/\/new-request$/);
  });

  test("[TC-034] [US03-AC5] the registration closing date must be between today and the event date", async ({ page }) => {
    test.fail(true, DEFECT);
    const eventDate = futureDate(30);
    await openNewRequest(page);
    await completeRequest(page, unique("Closing Date"), eventDate);
    await registrationBox(page).check();
    await regCapBox(page).fill("120");
    await expect(regCloseBox(page)).toHaveAttribute("max", eventDate);
    await regCloseBox(page).fill(futureDate(-1));
    await submit(page);
    await expect(page.getByText("Registration closing date cannot be in the past.").first()).toBeVisible();
    await regCloseBox(page).fill(futureDate(31));
    await submit(page);
    await expect(page.getByText("Registration must close on or before the event date.").first()).toBeVisible();
  });

  test("[TC-035] [US03-AC7] a draft can be saved, reopened and saved again without a duplicate", async ({ page, baseURL }, info) => {
    const name = unique("Postgrad Welcome Drinks");
    const maya = await apiAs(baseURL!, MAYA);
    await openNewRequest(page);
    await nameBox(page).fill(name);
    await page.getByRole("button", { name: "Save as draft" }).click();
    await expect(toast(page)).toContainText("Draft saved.");
    await expect(myEventsRow(page, name)).toBeVisible();

    await myEventsRow(page, name).getByRole("button", { name: "Continue" }).click();
    await expect(nameBox(page)).toHaveValue(name);
    await descriptionBox(page).fill("Added when the draft was reopened.");
    await page.getByRole("button", { name: "Save as draft" }).click();
    await expect(toast(page)).toContainText("Draft saved.");
    await expect(page).toHaveURL(/\/my-events$/);
    await expect(myEventsRow(page, name)).toHaveCount(1);
    await page.reload();
    await expect(myEventsRow(page, name)).toHaveCount(1);
    const stored = await saved(maya, name);
    expect(stored).toHaveLength(1);
    expect(stored[0].status).toBe("draft");
    expect(stored[0].purpose).toBe("Added when the draft was reopened.");
    observed(info, `The draft "${name}" was listed on My events; reopening showed its name, and saving it again with a description left one draft (also after a reload) holding the new description.`);
  });

  test("[TC-036] [US03-AC7] a submitted request is stored and still shown after a reload", async ({ page, baseURL }, info) => {
    const name = unique("Startup Pitch Night");
    await openNewRequest(page);
    await completeRequest(page, name, futureDate(30));
    await submit(page);
    await expect(toast(page)).toContainText(`${name} submitted for review.`);
    await expect(page).toHaveURL(/\/my-events$/);
    await expect(myEventsRow(page, name)).toContainText("Submitted");
    await page.reload();
    await expect(myEventsRow(page, name)).toContainText("Submitted");
    expect((await saved(await apiAs(baseURL!, MAYA), name)).map((e) => e.status)).toEqual(["submitted"]);
    observed(info, `"${name} submitted for review." was shown; My events listed it as Submitted, also after a reload, and the server holds one submitted request.`);
  });

  test("[TC-037] [US03-AC8] only Event Organisers can create event requests", async ({ page, baseURL }, info) => {
    await signIn(page, SAM, /\/browse/);
    await page.goto("/new-request");
    await expect(page).toHaveURL(/\/browse$/);
    await expect(toast(page)).toContainText("You don't have permission to view that page.");
    const sam = await apiAs(baseURL!, SAM);
    const name = unique("Attendee Request");
    expect((await sam.post("/api/events", { data: { name } })).status()).toBe(403);
    expect((await sam.post("/api/event-requests/submit", { data: { event_information: { name } } })).status()).toBe(403);
    expect((await sam.post("/api/event-requests/drafts", { data: { event_information: { name } } })).status()).toBe(403);
    observed(info, `As the attendee, /new-request returned to /browse with "You don't have permission to view that page."; POST /events, /event-requests/submit and /event-requests/drafts each returned 403.`);
  });
});
