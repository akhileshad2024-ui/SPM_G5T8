import { expect, test, type Locator, type Page } from "@playwright/test";
import { GRACE, MAYA, PRIYA, SAM, WEI, apiAs, assignTo, createRequest, myEventsRow, openInQueue, signIn, toast, unique } from "./support/app";
import { DANIEL, observed } from "./support/venues";
import { scenarioNames, seedScenario, type Scenario } from "./support/scenario";

/**
 * US15 — View Event Information (functional).
 * "As an involved user, I want to view the information of an event so that I have the details
 * relevant to my role."
 *
 * Test cases: docs/testing/US15_View_Event_Information_Test_Cases.xlsx (TC-051 to TC-062), run here in
 * a real browser against the functional-test database, with the same test-data events as US13
 * (tests/functional/support/seed_events.py).
 */
let s: Scenario;
let names: ReturnType<typeof scenarioNames>;
test.beforeAll(() => {
  s = seedScenario(unique("info"));
  names = scenarioNames(s);
});

const ALL_SECTIONS = ["Event", "People", "Venue", "Equipment", "Registration", "Review"];

// Fields each role gets, as backend/event_fields.py defines them.
const BASICS = ["id", "status", "name", "purpose", "eventType", "date", "start", "end", "organiserId", "organiser", "updatedAt"];
const FIELDS: Record<string, string[]> = {
  organiser: [...BASICS, "coordinatorId", "coordinator", "assignedBy", "assignedAt", "pax", "venueLocation", "venueCapacity", "layout",
    "facilities", "access", "venue", "venueName", "bookingState", "equip", "equipState", "reg", "regCap", "regClose", "registered",
    "withdrawalClose", "clarification", "decision", "submittedAt", "createdAt", "draftForm"],
  tech: [...BASICS, "coordinatorId", "coordinator", "pax", "venueName", "equip", "equipState"],
  attendee: [...BASICS, "access", "venueName", "reg", "regCap", "regClose", "registered", "withdrawalClose"],
};
FIELDS.coordinator = FIELDS.organiser.filter((f) => f !== "draftForm");
// US43: the coordinator's fields without the review notes between organiser and coordinator.
FIELDS.lead = FIELDS.coordinator.filter((f) => f !== "clarification" && f !== "decision");
FIELDS.venue = [...BASICS, "coordinatorId", "coordinator", "pax", "venueLocation", "venueCapacity", "layout", "facilities", "access",
  "venue", "venueName", "bookingState"];

/** Check only US15 details, not adjacent features such as US33 change requests. */
const sectionTitles = (scope: Locator) => scope.getByTestId("event-details").locator("section[aria-label]").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")));
/** The value shown for `label` in the `section` of the open details. */
const value = (scope: Locator, section: string, label: string) =>
  scope.locator(`section[aria-label="${section}"] dt`, { hasText: new RegExp(`^${label}$`) }).locator("xpath=following-sibling::dd[1]");
const rows = (scope: Locator, section: string) => scope.locator(`section[aria-label="${section}"] dt`).allTextContents();

/** The card (Booking requests, Equipment, Browse events) for the event called `name`, with its details opened. */
async function openCardDetails(page: Page, name: string): Promise<Locator> {
  const card = page.locator(".card").filter({ has: page.getByText(name, { exact: true }) }).filter({ has: page.getByRole("button", { name: "Details" }) });
  await card.getByRole("button", { name: "Details" }).click();
  await expect(card.getByText(/^Last updated /)).toBeVisible();
  return card;
}

async function checkValues(scope: Locator, expected: Array<[string, string, string]>) {
  for (const [section, label, text] of expected) await expect(value(scope, section, label), `${section} / ${label}`).toHaveText(text);
}

test.describe("US15 - View Event Information", () => {
  test("[TC-051] [US15-AC1] the organiser can view all the information of their own event", async ({ page }, info) => {
    await signIn(page, MAYA, /\/my-events/);
    await myEventsRow(page, names.symposium).getByRole("link", { name: "View" }).click();
    await expect(page).toHaveURL(new RegExp(`/my-events/${s.symposium}$`));
    const details = page.locator("body");
    await expect(page.getByRole("heading", { name: names.symposium })).toBeVisible();
    await expect(page.getByText(/^Last updated \d{2} \w{3} \d{4}, \d{2}:\d{2}$/)).toBeVisible();
    expect(await sectionTitles(details)).toEqual(ALL_SECTIONS);
    await checkValues(details, [
      ["Event", "Status", "Confirmed"], ["Event", "Event type", "Conference"], ["Event", "Time", "09:00 – 17:00"], ["Event", "Expected attendance", "180"],
      ["People", "Organiser", MAYA.name], ["People", "Coordinator", PRIYA.name],
      ["Venue", "Venue", s.venue], ["Venue", "Booking", "Approved"], ["Venue", "Preferred location", "Central campus"], ["Venue", "Required capacity", "200"],
      ["Venue", "Layout", "Theatre"], ["Venue", "Facilities", "Projector, PA system"], ["Venue", "Accessibility", "Wheelchair Access"],
      ["Equipment", "Requested", "2 × Projector (HDMI to lectern)"], ["Equipment", "Equipment status", "Requested"],
      ["Registration", "Attendee registration", "Open"], ["Registration", "Capacity limit", "200"],
      ["Review", "Decision", "Approved: Programme and venue confirmed."],
    ]);
    observed(info, `/my-events/${s.symposium} showed the name, Confirmed, "Last updated" and the sections ${ALL_SECTIONS.join(", ")} with the saved values (e.g. 2 × Projector (HDMI to lectern); Decision "Approved: Programme and venue confirmed.").`);
  });

  test("[TC-052] [US15-AC1] the coordinator can view the information of an event assigned to them", async ({ page }, info) => {
    await signIn(page, PRIYA, /\/queue/);
    await openInQueue(page, names.symposium);
    await expect(page.getByText(/^Last updated /).first()).toBeVisible();
    await page.getByRole("button", { name: "Details", exact: true }).click();
    const details = page.locator("body");
    // Wait for the actual details, not US34's already-visible arrangements panel.
    await expect(details.getByTestId("event-details")).toBeVisible();
    expect(await sectionTitles(details)).toEqual(ALL_SECTIONS);
    await checkValues(details, [["People", "Coordinator", PRIYA.name], ["Equipment", "Requested", "2 × Projector (HDMI to lectern)"],
      ["Review", "Decision", "Approved: Programme and venue confirmed."]]);
    observed(info, `The workspace header showed "Last updated"; Details showed the same six sections and values as the organiser sees.`);
  });

  test("[TC-053] [US15-AC1] venue staff can view the event and venue information of an event with a booking request", async ({ page }, info) => {
    await signIn(page, DANIEL, /\/bookings/);
    const card = await openCardDetails(page, names.pitch);
    expect(await sectionTitles(card)).toEqual(["Event", "People", "Venue"]);
    await checkValues(card, [["Venue", "Booking", "Pending"], ["Venue", "Preferred location", "Central campus"], ["Venue", "Required capacity", "120"],
      ["Venue", "Layout", "Standing"], ["Venue", "Accessibility", "None"], ["Event", "Expected attendance", "95"]]);
    observed(info, `Details for ${names.pitch} showed only Event, People and Venue (booking Pending, Central campus, 120, Standing, accessibility None); no Equipment, Registration or Review.`);
  });

  test("[TC-054] [US15-AC1] technical support can view the event and equipment information of an event requesting equipment", async ({ page }, info) => {
    await signIn(page, WEI, /\/equipment/);
    const card = await openCardDetails(page, names.symposium);
    expect(await sectionTitles(card)).toEqual(["Event", "People", "Venue", "Equipment"]);
    expect(await rows(card, "Venue")).toEqual(["Venue"]);
    await checkValues(card, [["Venue", "Venue", s.venue], ["Equipment", "Requested", "2 × Projector (HDMI to lectern)"]]);
    observed(info, `Details showed Event, People, the venue name only (${s.venue}) and Equipment (2 × Projector (HDMI to lectern)); no booking state, venue needs, accessibility, Registration or Review.`);
  });

  test("[TC-055] [US15-AC1] an attendee can view the public information of a confirmed event open for registration", async ({ page }, info) => {
    await signIn(page, SAM, /\/browse/);
    const card = await openCardDetails(page, names.symposium);
    expect(await sectionTitles(card)).toEqual(["Event", "People", "Venue", "Registration"]);
    expect(await rows(card, "Event")).not.toContain("Expected attendance");
    expect(await rows(card, "People")).toEqual(["Organiser"]);
    expect(await rows(card, "Venue")).toEqual(["Venue", "Accessibility"]);
    await checkValues(card, [["Registration", "Attendee registration", "Open"], ["Registration", "Capacity limit", "200"]]);
    observed(info, "Details showed Event (without expected attendance), the organiser only, the venue name and accessibility, and Registration (Open, 200); no coordinator, venue needs, booking, Equipment or Review.");
  });

  test("[TC-056] [US15-AC2] fields a role may not see are left out of the event data, not sent as empty", async ({ baseURL }, info) => {
    const counts: string[] = [];
    for (const [role, who] of [["organiser", MAYA], ["coordinator", PRIYA], ["lead", GRACE], ["venue", DANIEL], ["tech", WEI], ["attendee", SAM]] as const) {
      const event = await (await (await apiAs(baseURL!, who)).get(`/api/events/${s.symposium}`)).json();
      expect(Object.keys(event).sort(), role).toEqual([...FIELDS[role]].sort());
      counts.push(`${role} ${Object.keys(event).length}`);
    }
    const attendee = await (await (await apiAs(baseURL!, SAM)).get(`/api/events/${s.symposium}`)).json();
    expect(Object.entries(attendee).filter(([, v]) => v === null).map(([k]) => k)).toEqual([]);
    observed(info, `GET /events/{id} returned exactly each role's permitted fields (${counts.join(", ")}); hidden fields were absent rather than null, and the attendee's response had no null fields.`);
  });

  test("[TC-057] [US15-AC2] a permitted field with no value yet is shown as not set, not hidden", async ({ page }, info) => {
    // The request has no coordinator yet, so it is the Lead who sees it (US43).
    await signIn(page, GRACE, /\/assignments/);
    const details = page.locator(`[aria-label="Unassigned request: ${names.bare}"]`);
    await details.getByRole("button", { name: "Details", exact: true }).click();
    await expect(details.locator("section[aria-label]").first()).toBeVisible();
    await checkValues(details, [
      ["Event", "Expected attendance", "Not set"], ["People", "Coordinator", "Not yet assigned"], ["Venue", "Venue", "Not booked yet"],
      ["Venue", "Booking", "Not requested"], ["Venue", "Preferred location", "Not set"], ["Venue", "Required capacity", "Not set"],
      ["Venue", "Layout", "Not set"], ["Venue", "Facilities", "None"], ["Venue", "Accessibility", "None"], ["Equipment", "Requested", "None"],
      ["Equipment", "Equipment status", "None requested"], ["Registration", "Attendee registration", "Not required"],
    ]);
    observed(info, `Details for ${names.bare} showed every empty field: attendance Not set, coordinator Not yet assigned, venue Not booked yet, booking Not requested, location/capacity/layout Not set, facilities/accessibility/equipment None, equipment status None requested, registration Not required.`);
  });

  test("[TC-058] [US15-AC3] the details show the latest saved values and a later last-updated time after an edit", async ({ page }, info) => {
    const name = unique("Robotics Club Showcase");
    await signIn(page, MAYA, /\/my-events/);
    await page.getByRole("link", { name: "New request" }).click();
    await page.getByPlaceholder("Alumni Homecoming Dinner").fill(name);
    await page.locator("select.text-input").selectOption("other");
    await page.getByPlaceholder("180").fill("70");
    await page.getByRole("button", { name: "Save as draft" }).click();
    await expect(toast(page)).toContainText("Draft saved.");

    const view = async (title: string) => {
      await myEventsRow(page, title).getByRole("link", { name: "View" }).click();
      await expect(page.getByRole("heading", { name: title })).toBeVisible();
      const stamp = await page.locator("time").first().getAttribute("datetime");
      const pax = await value(page.locator("body"), "Event", "Expected attendance").textContent();
      await page.getByRole("link", { name: "← My events" }).click();
      return { stamp: Date.parse(stamp!), pax };
    };
    const first = await view(name);
    expect(first.pax).toBe("70");

    const renamed = `${name} 2026`;
    await myEventsRow(page, name).getByRole("button", { name: "Continue" }).click();
    await page.getByPlaceholder("Alumni Homecoming Dinner").fill(renamed);
    await page.getByPlaceholder("180").fill("85");
    // SQLite records whole seconds: save in a later second to test a later timestamp.
    await expect.poll(() => Date.now()).toBeGreaterThan(first.stamp + 1000);
    await page.getByRole("button", { name: "Save as draft" }).click();
    await expect(toast(page)).toContainText("Draft saved.");
    const second = await view(renamed);
    expect(second.pax).toBe("85");
    expect(second.stamp).toBeGreaterThan(first.stamp);
    observed(info, `The first View showed ${name} with 70 expected; after renaming to "${renamed}" with 85 the View showed the new values and a later last-updated time (${new Date(first.stamp).toISOString()} -> ${new Date(second.stamp).toISOString()}).`);
  });

  test("[TC-059] [US15-AC4] every role sees the same values and last-updated time for the same event", async ({ baseURL }, info) => {
    const get = async (who: typeof MAYA) => (await (await apiAs(baseURL!, who)).get(`/api/events/${s.symposium}`)).json();
    const organiser = await get(MAYA);
    for (const who of [PRIYA, DANIEL, WEI, SAM]) {
      const theirs = await get(who);
      for (const [field, v] of Object.entries(theirs)) expect(v, `${who.email} ${field}`).toEqual(organiser[field]);
    }
    for (const who of [PRIYA, SAM]) {
      const api = await apiAs(baseURL!, who);
      const listed = ((await (await api.get("/api/events")).json()) as Array<{ id: number }>).find((e) => e.id === s.symposium);
      expect(listed, who.email).toEqual(await (await api.get(`/api/events/${s.symposium}`)).json());
    }
    observed(info, `Every field returned to the coordinator, Venue Staff, Technical Support and the attendee had the organiser's value, including updatedAt ${organiser.updatedAt}; for the coordinator and the attendee the event in GET /events matched GET /events/{id}.`);
  });

  test("[TC-060] [US15-AC4] the coordinator sees the organiser's newly submitted values straight away", async ({ page, baseURL }, info) => {
    const name = unique("Robotics Club Showcase");
    const maya = await apiAs(baseURL!, MAYA);
    const id = await createRequest(maya, name, { attendance: 85, venueCapacity: 100 });
    await assignTo(await apiAs(baseURL!, GRACE), id, PRIYA);  // the Lead assigns Priya (US43)
    const organiser = await (await maya.get(`/api/events/${id}`)).json();

    await signIn(page, PRIYA, /\/queue/);
    await openInQueue(page, name);
    await page.getByRole("button", { name: "Details", exact: true }).click();
    const details = page.locator("body");
    await checkValues(details, [["Event", "Expected attendance", "85"], ["Venue", "Preferred location", "Central campus"], ["Venue", "Required capacity", "100"]]);
    expect(await page.locator('section[aria-label="Event"]').locator("xpath=preceding-sibling::div[1]//time").getAttribute("datetime")).toBe(organiser.updatedAt);
    observed(info, `Right after Maya submitted "${name}", Priya's Details showed 85 expected, Central campus and capacity 100, with the same last-updated time as the organiser's copy (${organiser.updatedAt}).`);
  });

  test("[TC-061] [US15-AC1] a user can't view the information of an event they're not involved in", async ({ baseURL }, info) => {
    const refused = async (who: typeof MAYA, id: number) => {
      const res = await (await apiAs(baseURL!, who)).get(`/api/events/${id}`);
      expect(res.status(), `${who.email} -> ${id}`).toBe(403);
      expect(await res.json()).toEqual({ detail: "You don't have permission to do that" });
    };
    for (const id of [s.mixer, s.bare]) await refused(DANIEL, id);
    for (const who of [WEI, SAM]) for (const id of [s.pitch, s.mixer, s.bare]) await refused(who, id);
    observed(info, "Venue Staff for the mixer and the submitted request, and Technical Support and the attendee for the pitch night, mixer and submitted request, were each refused with 403 \"You don't have permission to do that\".");
  });

  test("[TC-062] [US15-AC1] a missing event is reported as not found and a signed-out user can't view any event", async ({ page, baseURL }, info) => {
    const missing = await (await apiAs(baseURL!, DANIEL)).get("/api/events/999999");
    expect(missing.status()).toBe(404);
    expect(await missing.json()).toEqual({ detail: "Event not found" });
    await page.goto("/login");
    expect((await page.request.get("/api/events")).status()).toBe(401);
    expect((await page.request.get(`/api/events/${s.symposium}`)).status()).toBe(401);
    observed(info, 'As Venue Staff GET /events/999999 returned 404 "Event not found"; signed out, GET /events and GET /events/{id} returned 401.');
  });
});
