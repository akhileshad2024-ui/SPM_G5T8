import { expect, test, type Page } from "@playwright/test";
import { PRIYA, apiAs, openInQueue, signIn, toast, unique } from "./support/app";
import { DANIEL, catalogueCard, createVenue, eventFor, futureDate, observed, openVenueTab, resultCard } from "./support/venues";

/**
 * US37 — Configure Venue Setup and Turnaround Time (functional).
 * "As a Venue Staff member, I want to set a setup time and a turnaround time for each venue so that
 * availability and conflict checks include the time needed to prepare and reset the room."
 *
 * Test cases: tests/functional/report/test_cases.py.
 */
const BUFFER_ERROR = "Enter whole minutes from 0 to 1440.";

async function openCatalogue(page: Page) {
  await signIn(page, DANIEL, /\/bookings/);
  await page.goto("/catalogue");
  await expect(page.getByRole("heading", { name: "Venue Catalogue" })).toBeVisible();
}

async function startNewVenue(page: Page, name: string) {
  await page.getByRole("button", { name: "+ Add Venue" }).click();
  await page.getByLabel("Venue name").fill(name);
  await page.getByLabel("Location", { exact: true }).fill("Test location");
  await page.getByLabel("Capacity").fill("100");
}

const setup = (page: Page) => page.getByLabel("Setup minutes");
const turnaround = (page: Page) => page.getByLabel("Turnaround minutes");

test.describe("US37 - Configure Venue Setup and Turnaround Time", () => {
  test("[TC-US37-01] [US37-AC1] Venue Staff can set setup and turnaround minutes for a venue", async ({ page }, info) => {
    const name = unique("Timed Hall");
    await openCatalogue(page);

    await startNewVenue(page, name);
    await setup(page).fill("30");
    await turnaround(page).fill("45");
    await page.getByRole("button", { name: "Save Venue" }).click();
    await expect(toast(page)).toContainText(`${name} added to the catalogue.`);
    await expect(catalogueCard(page, name).getByText("Setup: 30 min · Turnaround: 45 min")).toBeVisible();

    await catalogueCard(page, name).getByRole("button", { name: "Edit" }).click();
    await setup(page).fill("15");
    await turnaround(page).fill("20");
    await page.getByRole("button", { name: "Save Venue" }).click();
    await expect(toast(page)).toContainText(`${name} updated.`);
    await page.reload();
    await expect(catalogueCard(page, name).getByText("Setup: 15 min · Turnaround: 20 min")).toBeVisible();
    observed(info, `A new venue saved with setup 30 min and turnaround 45 min showed "Setup: 30 min · Turnaround: 45 min" on its card. After editing to 15 and 20 the card showed "Setup: 15 min · Turnaround: 20 min", also after a reload.`);
  });

  test("[TC-US37-02] [US37-AC2] a missing or negative value shows a validation error and nothing is saved", async ({ page, baseURL }, info) => {
    const name = unique("Invalid Hall");
    await openCatalogue(page);
    await startNewVenue(page, name);
    const save = page.getByRole("button", { name: "Save Venue" });

    const refused: string[] = [];
    for (const [label, field, value] of [
      ["blank setup", setup(page), ""],
      ["blank turnaround", turnaround(page), ""],
      ["negative setup", setup(page), "-5"],
      ["negative turnaround", turnaround(page), "-1"],
      ["setup over a day", setup(page), "1441"],
    ] as const) {
      await setup(page).fill("0");
      await turnaround(page).fill("0");
      await field.fill(value);
      await save.click();
      await expect(page.getByText(BUFFER_ERROR), label).toHaveCount(1);
      await expect(page.getByLabel("Venue name"), `${label}: form should stay open`).toBeVisible();
      refused.push(`${label} (${value === "" ? "empty" : value})`);
    }

    // The limits themselves are fine: 0 (none needed) and 1440 (a full day).
    await setup(page).fill("0");
    await turnaround(page).fill("1440");
    await save.click();
    await expect(toast(page)).toContainText(`${name} added to the catalogue.`);

    // The server refuses a venue with no setup or turnaround at all.
    const staff = await apiAs(baseURL!, DANIEL);
    for (const missing of ["setupMinutes", "turnaroundMinutes"]) {
      const body: Record<string, unknown> = { name: unique("No Times"), location: "x", cap: 10, setupMinutes: 0, turnaroundMinutes: 0 };
      delete body[missing];
      const res = await staff.post("/api/venues", { data: body });
      expect(res.status(), missing).toBe(422);
    }
    observed(info, `The form showed "${BUFFER_ERROR}" and stayed open for: ${refused.join("; ")}. Setup 0 with turnaround 1440 was accepted. The server answered 422 to a new venue sent without setupMinutes, and without turnaroundMinutes.`);
  });

  test("[TC-US37-03] [US37-AC3] each change is recorded with the editing user and a timestamp", async ({ page, baseURL }, info) => {
    const staff = await apiAs(baseURL!, DANIEL);
    const venue = await createVenue(staff, { setupMinutes: 30, turnaroundMinutes: 45 });
    await openCatalogue(page);

    await catalogueCard(page, venue.name).getByRole("button", { name: "Edit" }).click();
    await setup(page).fill("10");
    await turnaround(page).fill("60");
    await page.getByRole("button", { name: "Save Venue" }).click();
    await expect(toast(page)).toContainText(`${venue.name} updated.`);

    await expect(catalogueCard(page, venue.name).getByText(new RegExp(`Last changed by ${DANIEL.email}`))).toBeVisible();
    const history: Array<{ action: string; changed_by: string; changed_at: string; changes: Record<string, { old: number; new: number }> }> =
      await (await staff.get(`/api/venues/${venue.id}/history`)).json();
    const edit = history[history.length - 1];
    expect(edit.action).toBe("edit");
    expect(edit.changed_by).toBe(DANIEL.email);
    expect(Number.isNaN(Date.parse(edit.changed_at))).toBe(false);
    expect(edit.changes.setupMinutes).toEqual({ old: 30, new: 10 });
    expect(edit.changes.turnaroundMinutes).toEqual({ old: 45, new: 60 });
    observed(info, `The card showed "Last changed by ${DANIEL.email}". The venue's history ended with an "edit" by ${DANIEL.email} at ${edit.changed_at}, recording setup 30 -> 10 and turnaround 45 -> 60.`);
  });

  test("[TC-US37-04] [US37-AC4] venue search treats a venue as occupied from start minus setup to end plus turnaround", async ({ page, baseURL }, info) => {
    const staff = await apiAs(baseURL!, DANIEL);
    const location = unique("Buffer Plaza");
    const date = futureDate(28);
    const maintenance = [{ start: `${date}T10:00`, end: `${date}T12:00`, reason: "maintenance" }];
    const buffered = await createVenue(staff, { name: unique("Buffered Hall"), location, setupMinutes: 30, turnaroundMinutes: 45, unavailability: maintenance });
    const unbuffered = await createVenue(staff, { name: unique("Unbuffered Hall"), location, setupMinutes: 0, turnaroundMinutes: 0, unavailability: maintenance });

    await signIn(page, PRIYA, /\/queue/);
    await page.goto("/venues");
    await page.locator("label.field").filter({ has: page.getByText("Location", { exact: true }) }).locator("select").selectOption({ label: location });
    await page.getByLabel("Date", { exact: true }).fill(date);

    const searchFor = async (start: string, end: string) => {
      await page.getByLabel("Start time").fill(start);
      await page.getByLabel("End time").fill(end);
      await Promise.all([
        page.waitForResponse((r) => r.url().includes("/venues/search") && r.request().method() === "POST"),
        page.getByRole("button", { name: "Search", exact: true }).click(),
      ]);
      await expect(page.getByText(/venues? found|No venues match/)).toBeVisible();
    };
    const shown = async (name: string) => (await page.getByText(name, { exact: true }).count()) > 0;

    // Maintenance is 10:00-12:00. With 30 min setup the room is needed from 30 min before the event.
    const results: string[] = [];
    for (const [start, end, bufferedShown, unbufferedShown, why] of [
      ["12:30", "14:00", true, true, "setup ends exactly as maintenance ends"],
      ["12:29", "14:00", false, true, "setup starts one minute inside maintenance"],
      ["12:15", "14:00", false, true, "no setup needed at the unbuffered venue"],
      ["08:00", "09:15", true, true, "turnaround ends exactly as maintenance starts"],
      ["08:00", "09:16", false, true, "turnaround runs one minute into maintenance"],
    ] as const) {
      await searchFor(start, end);
      expect(await shown(buffered.name), `${start}-${end} buffered: ${why}`).toBe(bufferedShown);
      expect(await shown(unbuffered.name), `${start}-${end} unbuffered: ${why}`).toBe(unbufferedShown);
      results.push(`${start}-${end}: ${bufferedShown ? "listed" : "not listed"} (${why})`);
    }
    observed(info, `Maintenance 10:00-12:00 at a venue with 30 min setup and 45 min turnaround: ${results.join("; ")}. The venue with no setup or turnaround was listed every time.`);
  });

  test("[TC-US37-05] [US37-AC5] a booking request takes setup and teardown from the venue, not from per-booking entry", async ({ page, baseURL }, info) => {
    const staff = await apiAs(baseURL!, DANIEL);
    const date = futureDate(40);
    const venue = await createVenue(staff, { name: unique("Settings Hall"), cap: 200, layouts: ["theatre"], facilities: ["Projector"], accessibility: ["Wheelchair Access"], setupMinutes: 20, turnaroundMinutes: 60 });
    const event = unique("Settings Event");
    await eventFor(baseURL!, event, { attendance: 120, layout: "theatre", facilities: ["Projector"], accessibility: ["Wheelchair Access"], date });

    await signIn(page, PRIYA, /\/queue/);
    await openInQueue(page, event);
    await openVenueTab(page);
    // Nothing to type: the Venue tab has no setup or teardown input.
    await expect(page.getByLabel(/setup|teardown|turnaround/i)).toHaveCount(0);
    const [request, response] = await Promise.all([
      page.waitForRequest((r) => /\/api\/venues\/\d+\/booking-requests/.test(r.url())),
      page.waitForResponse((r) => /\/api\/venues\/\d+\/booking-requests/.test(r.url())),
      resultCard(page, venue.name).getByRole("button", { name: "Request booking", exact: true }).click(),
    ]);

    const sent = JSON.stringify(request.postDataJSON());
    expect(sent).not.toMatch(/setup|teardown|turnaround/i);
    const { booking } = await response.json();
    expect(booking.setup_minutes).toBe(20);
    expect(booking.teardown_minutes).toBe(60);
    expect(booking.hold_start).toContain(`${date}T09:40`);
    expect(booking.hold_end).toContain(`${date}T13:00`);
    observed(info, `The Venue tab had no setup or teardown field and the request sent contained none. The booking recorded setup 20 min and teardown 60 min, taken from the venue's settings, holding the venue ${date} 09:40-13:00 for an event at 10:00-12:00.`);
  });
});
