import { expect, test } from "@playwright/test";
import { PRIYA, apiAs, signIn, unique } from "./support/app";
import { DANIEL, createVenue, observed, updateVenue, venueRow } from "./support/venues";

/**
 * US18 — View Venue Details (functional).
 * "As an Event Coordinator, I want to view venue details so that I can understand the
 * available venue options."
 *
 * Test cases: tests/functional/report/test_cases.py.
 */
test.describe("US18 - View Venue Details", () => {
  test("[TC-US18-01] [US18-AC1] a coordinator can open the full details of an active venue", async ({ page, baseURL }, info) => {
    const staff = await apiAs(baseURL!, DANIEL);
    const venue = await createVenue(staff, { name: unique("Lecture Theatre"), location: unique("North wing"), cap: 150 });

    await signIn(page, PRIYA, /\/queue/);
    await page.goto("/venues");
    await expect(page.getByText("Choose a venue to see its details.")).toBeVisible();
    await venueRow(page, venue.name).getByRole("button", { name: "View details" }).click();

    const details = page.getByLabel(`Details of ${venue.name}`);
    await expect(details).toBeVisible();
    await expect(details.getByText(venue.name, { exact: true })).toBeVisible();
    observed(info, `Choosing "View details" for ${venue.name} opened its details panel (headed "${venue.name}"); before choosing, the page said "Choose a venue to see its details."`);
  });

  test("[TC-US18-02] [US18-AC2] the details show capacity, location, facilities, accessibility and layouts", async ({ page, baseURL }, info) => {
    const staff = await apiAs(baseURL!, DANIEL);
    const venue = await createVenue(staff, {
      name: unique("Lecture Theatre"),
      location: unique("North wing"),
      cap: 150,
      layouts: ["theatre", "classroom"],
      facilities: ["Projector", "PA system"],
      accessibility: ["Wheelchair Access", "Special Physical Seating"],
    });

    await signIn(page, PRIYA, /\/queue/);
    await page.goto("/venues");
    await venueRow(page, venue.name).getByRole("button", { name: "View details" }).click();

    const details = page.getByLabel(`Details of ${venue.name}`);
    await expect(details.getByText(venue.location)).toBeVisible();
    await expect(details.getByText("150", { exact: true })).toBeVisible();
    await expect(details.getByText("Capacity", { exact: true })).toBeVisible();
    for (const tag of ["Theatre", "Classroom", "Projector", "PA system", "Wheelchair Access", "Special Physical Seating"]) {
      await expect(details.getByText(tag, { exact: true })).toBeVisible();
    }
    observed(info, `The details panel showed location "${venue.location}", capacity 150, layouts Theatre and Classroom, facilities Projector and PA system, and accessibility Wheelchair Access and Special Physical Seating.`);
  });

  test("[TC-US18-03] [US18-AC3] the coordinator's view is read-only and the venue cannot be edited", async ({ page, baseURL }, info) => {
    const staff = await apiAs(baseURL!, DANIEL);
    const venue = await createVenue(staff);
    const priya = await apiAs(baseURL!, PRIYA);

    await signIn(page, PRIYA, /\/queue/);
    await page.goto("/venues");
    await venueRow(page, venue.name).getByRole("button", { name: "View details" }).click();
    const details = page.getByLabel(`Details of ${venue.name}`);
    await expect(details).toBeVisible();

    // No editing controls anywhere in the details.
    await expect(details.locator("input, textarea, select, button")).toHaveCount(0);
    // The catalogue (where venues are edited) is not open to a coordinator.
    await page.goto("/catalogue");
    await expect(page).not.toHaveURL(/\/catalogue/);
    await expect(page.getByRole("button", { name: "+ Add Venue" })).toHaveCount(0);
    // And the backend refuses an edit from a coordinator.
    const edit = await priya.put(`/api/venues/${venue.id}`, { data: { cap: 1 } });
    expect(edit.status()).toBe(403);
    observed(info, `The details panel contained no inputs, buttons or dropdowns. Opening /catalogue redirected the coordinator to ${new URL(page.url()).pathname} with no "+ Add Venue" button, and a direct edit request (PUT /venues/${venue.id}) was refused with 403.`);
  });

  test("[TC-US18-04] [US18-AC4] a deactivated venue is left out of the list", async ({ page, baseURL }, info) => {
    const staff = await apiAs(baseURL!, DANIEL);
    const kept = await createVenue(staff, { name: unique("Open Room") });
    const gone = await createVenue(staff, { name: unique("Closed Room") });
    await updateVenue(staff, gone.id, { is_active: false });

    await signIn(page, PRIYA, /\/queue/);
    await page.goto("/venues");

    await expect(venueRow(page, kept.name)).toBeVisible();
    await expect(page.getByText(gone.name)).toHaveCount(0);
    observed(info, `The venue list showed the active venue "${kept.name}" and did not show the deactivated venue "${gone.name}".`);
  });
});
