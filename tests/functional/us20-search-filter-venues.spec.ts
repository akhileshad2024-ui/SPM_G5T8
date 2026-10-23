import { expect, test, type Page } from "@playwright/test";
import { PRIYA, apiAs, signIn, unique } from "./support/app";
import { ALL_DAYS, DANIEL, createVenue, futureDate, observed, venueRow } from "./support/venues";

/**
 * US20 — Search and Filter Venues (functional).
 * "As an Event Coordinator, I want to search and filter venues by event timing, attendance,
 * location, accessibility, layout, and facilities so that I can find suitable options efficiently."
 *
 * Every test puts its venues in a location of its own and picks that location, so the
 * other venues in the shared database never get in the way.
 *
 * Test cases: tests/functional/report/test_cases.py.
 */

async function openVenues(page: Page) {
  await signIn(page, PRIYA, /\/queue/);
  await page.goto("/venues");
  await expect(page.getByRole("button", { name: "Search", exact: true })).toBeVisible();
}

/** Presses Search and waits for the answer. Returns how long the answer took. */
async function search(page: Page): Promise<number> {
  const started = Date.now();
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/venues/search") && r.request().method() === "POST"),
    page.getByRole("button", { name: "Search", exact: true }).click(),
  ]);
  expect(response.ok()).toBeTruthy();
  await expect(page.getByText(/venues? found|No venues match/)).toBeVisible();
  return Date.now() - started;
}

async function clearChip(page: Page, label: string) {
  await Promise.all([
    page.waitForResponse((r) => r.url().includes("/venues/search") && r.request().method() === "POST"),
    page.getByRole("button", { name: `Clear ${label} filter` }).click(),
  ]);
}

/** A dropdown on the search form. (Its accessible name includes its options, so it is found by its label text.) */
const selectFor = (page: Page, label: string) =>
  page.locator("label.field").filter({ has: page.getByText(label, { exact: true }) }).locator("select");

async function inLocation(page: Page, location: string) {
  await selectFor(page, "Location").selectOption({ label: location });
}

const listed = (page: Page, name: string) => venueRow(page, name);

test.describe("US20 - Search and Filter Venues", () => {
  test("[TC-US20-01] [US20-AC1] search by expected attendance", async ({ page, baseURL }, info) => {
    const staff = await apiAs(baseURL!, DANIEL);
    const location = unique("Attendance Plaza");
    const small = await createVenue(staff, { name: unique("Small"), location, cap: 50 });
    const exact = await createVenue(staff, { name: unique("Exact"), location, cap: 120 });
    const large = await createVenue(staff, { name: unique("Large"), location, cap: 300 });

    await openVenues(page);
    await inLocation(page, location);
    await page.getByLabel("Expected attendance").fill("120");
    await search(page);

    await expect(listed(page, exact.name)).toBeVisible(); // capacity equal to the attendance fits
    await expect(listed(page, large.name)).toBeVisible();
    await expect(page.getByText(small.name)).toHaveCount(0);
    await expect(page.getByText("2 venues found")).toBeVisible();
    observed(info, `For an attendance of 120, the venues with capacity 120 and 300 were listed and the venue with capacity 50 was not ("2 venues found").`);
  });

  test("[TC-US20-02] [US20-AC1] search by location", async ({ page, baseURL }, info) => {
    const staff = await apiAs(baseURL!, DANIEL);
    const here = unique("North wing");
    const there = unique("South wing");
    const a = await createVenue(staff, { name: unique("North Room"), location: here });
    const b = await createVenue(staff, { name: unique("South Room"), location: there });

    await openVenues(page);
    await inLocation(page, here);
    await search(page);

    await expect(listed(page, a.name)).toBeVisible();
    await expect(page.getByText(b.name)).toHaveCount(0);
    observed(info, `Choosing the location "${here}" listed ${a.name} and left out ${b.name}, which is at "${there}".`);
  });

  test("[TC-US20-03] [US20-AC1] search by layout", async ({ page, baseURL }, info) => {
    const staff = await apiAs(baseURL!, DANIEL);
    const location = unique("Layout Plaza");
    const theatre = await createVenue(staff, { name: unique("Theatre Room"), location, layouts: ["theatre"] });
    const boardroom = await createVenue(staff, { name: unique("Board Room"), location, layouts: ["boardroom"] });

    await openVenues(page);
    await inLocation(page, location);
    await selectFor(page, "Layout").selectOption({ label: "Boardroom" });
    await search(page);

    await expect(listed(page, boardroom.name)).toBeVisible();
    await expect(page.getByText(theatre.name)).toHaveCount(0);
    observed(info, `Filtering for the Boardroom layout listed ${boardroom.name} and left out ${theatre.name} (theatre only).`);
  });

  test("[TC-US20-04] [US20-AC1] search by required facilities (all must be offered)", async ({ page, baseURL }, info) => {
    const staff = await apiAs(baseURL!, DANIEL);
    const location = unique("Facility Plaza");
    const both = await createVenue(staff, { name: unique("Full Room"), location, facilities: ["Projector", "Stage"] });
    const one = await createVenue(staff, { name: unique("Plain Room"), location, facilities: ["Projector"] });

    await openVenues(page);
    await inLocation(page, location);
    await page.getByLabel("Projector").check();
    await page.getByLabel("Stage").check();
    await search(page);

    await expect(listed(page, both.name)).toBeVisible();
    await expect(page.getByText(one.name)).toHaveCount(0);
    observed(info, `Asking for Projector and Stage listed ${both.name} (has both) and left out ${one.name} (Projector only).`);
  });

  test("[TC-US20-05] [US20-AC1] search by accessibility feature", async ({ page, baseURL }, info) => {
    const staff = await apiAs(baseURL!, DANIEL);
    const location = unique("Access Plaza");
    const seating = await createVenue(staff, { name: unique("Seated Room"), location, accessibility: ["Wheelchair Access", "Special Physical Seating"] });
    const wheelchair = await createVenue(staff, { name: unique("Ramp Room"), location, accessibility: ["Wheelchair Access"] });

    await openVenues(page);
    await inLocation(page, location);
    await page.getByLabel("Special Physical Seating").check();
    await search(page);

    await expect(listed(page, seating.name)).toBeVisible();
    await expect(page.getByText(wheelchair.name)).toHaveCount(0);
    observed(info, `Asking for Special Physical Seating listed ${seating.name} and left out ${wheelchair.name} (Wheelchair Access only).`);
  });

  test("[TC-US20-06] [US20-AC1] search by date and time", async ({ page, baseURL }, info) => {
    const staff = await apiAs(baseURL!, DANIEL);
    const location = unique("Timing Plaza");
    const date = futureDate(20);
    const free = await createVenue(staff, { name: unique("Free Room"), location });
    const maintenance = await createVenue(staff, {
      name: unique("Maintenance Room"),
      location,
      unavailability: [{ start: `${date}T09:00`, end: `${date}T13:00`, reason: "maintenance" }],
    });

    await openVenues(page);
    await inLocation(page, location);
    await page.getByLabel("Date", { exact: true }).fill(date);
    await page.getByLabel("Start time").fill("10:00");
    await page.getByLabel("End time").fill("12:00");
    await search(page);

    await expect(listed(page, free.name)).toBeVisible();
    await expect(page.getByText(maintenance.name)).toHaveCount(0);
    observed(info, `Searching ${date} 10:00-12:00 listed ${free.name} and left out ${maintenance.name}, which is under maintenance 09:00-13:00 that day.`);
  });

  test("[TC-US20-07] [US20-AC2] several filters can be applied together and cleared one at a time", async ({ page, baseURL }, info) => {
    const staff = await apiAs(baseURL!, DANIEL);
    const location = unique("Combo Plaza");
    const match = await createVenue(staff, { name: unique("Match"), location, cap: 200, layouts: ["theatre"], facilities: ["Projector"] });
    const wrongLayout = await createVenue(staff, { name: unique("Boardroom Only"), location, cap: 200, layouts: ["boardroom"], facilities: ["Projector"] });
    const tooSmall = await createVenue(staff, { name: unique("Too Small"), location, cap: 50, layouts: ["theatre"], facilities: ["Projector"] });

    await openVenues(page);
    await inLocation(page, location);
    await page.getByLabel("Expected attendance").fill("100");
    await selectFor(page, "Layout").selectOption({ label: "Theatre" });
    await page.getByLabel("Projector").check();
    await search(page);

    // All four filters together leave only the venue that meets every one, and each shows as a chip.
    await expect(listed(page, match.name)).toBeVisible();
    await expect(page.getByText(wrongLayout.name)).toHaveCount(0);
    await expect(page.getByText(tooSmall.name)).toHaveCount(0);
    for (const label of ["Location", "Expected attendance", "Layout", "Facilities"]) {
      await expect(page.getByRole("button", { name: `Clear ${label} filter` })).toBeVisible();
    }

    // Clearing the layout brings back the boardroom-only venue, and nothing else changes.
    await clearChip(page, "Layout");
    await expect(listed(page, wrongLayout.name)).toBeVisible();
    await expect(page.getByText(tooSmall.name)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Clear Layout filter" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Clear Expected attendance filter" })).toBeVisible();

    // Clearing the attendance brings back the small venue.
    await clearChip(page, "Expected attendance");
    await expect(listed(page, tooSmall.name)).toBeVisible();
    await expect(page.getByRole("button", { name: "Clear Location filter" })).toBeVisible();
    observed(info, `With Location, Expected attendance, Layout and Facilities all applied only ${match.name} was listed, each filter had its own clear button. Clearing Layout added ${wrongLayout.name}; clearing Expected attendance then added ${tooSmall.name}; the other filters stayed applied.`);
  });

  test("[TC-US20-08] [US20-AC3] only venues that are free for the period are shown", async ({ page, baseURL }, info) => {
    const staff = await apiAs(baseURL!, DANIEL);
    const location = unique("Free Plaza");
    const date = futureDate(21);
    const weekday = ALL_DAYS[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7]; // Monday-first
    const otherDays = ALL_DAYS.filter((d) => d !== weekday);
    const open = await createVenue(staff, { name: unique("Open Room"), location });
    const closedThatDay = await createVenue(staff, { name: unique("Closed Day Room"), location, operatingDays: otherDays });
    const opensLate = await createVenue(staff, { name: unique("Late Room"), location, operatingHours: "13:00 - 22:00" });

    await openVenues(page);
    await inLocation(page, location);
    await page.getByLabel("Date", { exact: true }).fill(date);
    await page.getByLabel("Start time").fill("10:00");
    await page.getByLabel("End time").fill("12:00");
    await search(page);

    await expect(listed(page, open.name)).toBeVisible();
    await expect(page.getByText(closedThatDay.name)).toHaveCount(0); // closed that weekday
    await expect(page.getByText(opensLate.name)).toHaveCount(0); // opens after the event starts
    await expect(page.getByText("1 venue found")).toBeVisible();
    observed(info, `For ${date} 10:00-12:00 only ${open.name} was listed ("1 venue found"). ${closedThatDay.name} (closed on ${weekday}s) and ${opensLate.name} (opens 13:00) were left out.`);
  });

  test("[TC-US20-09] [US20-AC4] when no venue matches the coordinator is told and the applied filters are shown", async ({ page, baseURL }, info) => {
    const staff = await apiAs(baseURL!, DANIEL);
    const location = unique("Empty Plaza");
    await createVenue(staff, { location, cap: 100 });

    await openVenues(page);
    await inLocation(page, location);
    await page.getByLabel("Expected attendance").fill("9999");
    await search(page);

    await expect(page.getByText("No venues match the filters applied.")).toBeVisible();
    await expect(page.getByText("Filters applied", { exact: true })).toBeVisible();
    await expect(page.getByText(`Location: ${location}`)).toBeVisible();
    await expect(page.getByText("Expected attendance: 9999")).toBeVisible();
    observed(info, `The page said "No venues match the filters applied." and still listed the applied filters "Location: ${location}" and "Expected attendance: 9999", each with a clear button.`);
  });

  test("[TC-US20-10] [US20-AC5] search results come back within 3 seconds", async ({ page, baseURL }, info) => {
    const staff = await apiAs(baseURL!, DANIEL);
    const location = unique("Speed Plaza");
    for (let i = 0; i < 5; i++) await createVenue(staff, { name: unique(`Speed Room ${i}`), location });

    await openVenues(page);
    await inLocation(page, location);
    await page.getByLabel("Expected attendance").fill("50");
    await page.getByLabel("Projector").check();
    await page.getByLabel("Date", { exact: true }).fill(futureDate(22));
    await page.getByLabel("Start time").fill("10:00");
    await page.getByLabel("End time").fill("12:00");

    const elapsed = await search(page);

    expect(elapsed).toBeLessThan(3000);
    await expect(page.getByText("5 venues found")).toBeVisible();
    observed(info, `A search using location, attendance, facility and date/time filters showed its 5 results ${elapsed} ms after pressing Search (limit 3000 ms).`);
  });
});
