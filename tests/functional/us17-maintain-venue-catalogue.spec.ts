import { expect, test, type Page } from "@playwright/test";
import { PRIYA, apiAs, signIn, toast, unique } from "./support/app";
import { DANIEL, catalogueCard, createVenue, observed } from "./support/venues";

/**
 * US17 — Maintain Venue Catalogue (functional).
 * "As a Venue Staff member, I want to maintain venue details such as capacity, location,
 * facilities, accessibility, and supported layouts so that planning decisions use accurate
 * venue information."
 *
 * Test cases: tests/functional/report/test_cases.py.
 */

/** Venue Staff opens the catalogue. */
async function openCatalogue(page: Page) {
  await signIn(page, DANIEL, /\/bookings/);
  await page.goto("/catalogue");
  await expect(page.getByRole("heading", { name: "Venue Catalogue" })).toBeVisible();
}

/** Fills the Add Venue form with the details of a typical lecture theatre. */
async function fillNewVenue(page: Page, name: string, location: string, capacity = "250") {
  await page.getByRole("button", { name: "+ Add Venue" }).click();
  await page.getByLabel("Venue name").fill(name);
  await page.getByLabel("Location", { exact: true }).fill(location);
  await page.getByLabel("Capacity").fill(capacity);
  await page.getByLabel("Theatre").check();
  await page.getByLabel("Classroom").check();
  await page.getByLabel("Projector").check();
  await page.getByLabel("PA system").check();
  await page.getByLabel("Wheelchair Access").check();
}

test.describe("US17 - Maintain Venue Catalogue", () => {
  test("[TC-US17-01] [US17-AC1] Venue Staff can add a venue to the catalogue", async ({ page }, info) => {
    const name = unique("Lecture Theatre");
    await openCatalogue(page);

    await fillNewVenue(page, name, "North wing");
    await page.getByRole("button", { name: "Save Venue" }).click();

    await expect(toast(page)).toContainText(`${name} added to the catalogue.`);
    await expect(catalogueCard(page, name)).toBeVisible();
    observed(info, `The toast said "${name} added to the catalogue." and a card for ${name} appeared in the catalogue.`);
  });

  test("[TC-US17-02] [US17-AC1] Venue Staff can edit a venue", async ({ page, baseURL }, info) => {
    const venue = await createVenue(await apiAs(baseURL!, DANIEL), { cap: 200 });
    await openCatalogue(page);

    await catalogueCard(page, venue.name).getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Capacity").fill("320");
    await page.getByRole("button", { name: "Save Venue" }).click();

    await expect(toast(page)).toContainText(`${venue.name} updated.`);
    await expect(catalogueCard(page, venue.name).getByText("320", { exact: true })).toBeVisible();
    await page.reload();
    await expect(catalogueCard(page, venue.name).getByText("320", { exact: true })).toBeVisible();
    observed(info, `After changing the capacity from 200 to 320 the toast said "${venue.name} updated." and the card showed 320, still shown after reloading the page.`);
  });

  test("[TC-US17-03] [US17-AC1] Venue Staff can deactivate a venue and reactivate it", async ({ page, baseURL }, info) => {
    const venue = await createVenue(await apiAs(baseURL!, DANIEL));
    await openCatalogue(page);

    await catalogueCard(page, venue.name).getByRole("button", { name: "Deactivate" }).click();
    await page.getByRole("button", { name: "Deactivate venue" }).click();
    await expect(toast(page)).toContainText(`${venue.name} deactivated.`);
    // Gone from the default list, but still in the catalogue under "Show deactivated".
    await expect(catalogueCard(page, venue.name)).toHaveCount(0);
    await page.getByLabel(/Show deactivated/).check();
    await expect(catalogueCard(page, venue.name).getByText("Deactivated", { exact: true })).toBeVisible();

    await catalogueCard(page, venue.name).getByRole("button", { name: "Reactivate" }).click();
    await expect(toast(page)).toContainText(`${venue.name} reactivated.`);
    await expect(catalogueCard(page, venue.name).getByText("Deactivated", { exact: true })).toHaveCount(0);
    observed(info, `Deactivating removed ${venue.name} from the list; under "Show deactivated" it carried a Deactivated tag. Reactivating removed the tag again.`);
  });

  test("[TC-US17-04] [US17-AC1] a venue cannot be deleted, only deactivated", async ({ page, baseURL }, info) => {
    const staff = await apiAs(baseURL!, DANIEL);
    const venue = await createVenue(staff);
    await openCatalogue(page);

    await expect(catalogueCard(page, venue.name).getByRole("button", { name: /delete|remove/i })).toHaveCount(0);
    const res = await staff.delete(`/api/venues/${venue.id}`);
    expect(res.status()).toBe(409);
    expect((await res.json()).detail).toContain("Deactivate the venue instead");
    observed(info, `The venue card had no Delete button. A direct delete request was refused with 409: "${(await res.json()).detail}"`);
  });

  test("[TC-US17-05] [US17-AC2] the venue records capacity, location, facilities, accessibility and layouts", async ({ page }, info) => {
    const name = unique("Seminar Room");
    const location = unique("East block");
    await openCatalogue(page);

    await fillNewVenue(page, name, location, "80");
    await page.getByRole("button", { name: "Save Venue" }).click();

    const card = catalogueCard(page, name);
    await expect(card.getByText(location)).toBeVisible();
    await expect(card.getByText("80", { exact: true })).toBeVisible();
    for (const text of ["theatre", "classroom", "Projector", "PA system", "Wheelchair Access"]) {
      await expect(card.getByText(text, { exact: true })).toBeVisible();
    }
    observed(info, `The saved card showed location "${location}", capacity 80, layouts theatre and classroom, facilities Projector and PA system, and accessibility Wheelchair Access.`);
  });

  test("[TC-US17-06] [US17-AC2] accessibility can only be chosen from the fixed set of features", async ({ page }, info) => {
    await openCatalogue(page);
    await page.getByRole("button", { name: "+ Add Venue" }).click();

    const section = page.getByText("Accessibility Features", { exact: true }).locator(".."); // the title's own section
    const options = await section.locator('input[type="checkbox"]').evaluateAll((boxes) =>
      boxes.map((b) => (b.closest("label")?.textContent ?? "").trim()),
    );
    expect(options).toEqual(["Wheelchair Access", "Special Physical Seating", "Mobility/Facility Arrangements"]);
    await expect(section.locator('input[type="text"]')).toHaveCount(0); // no free text
    observed(info, `The Accessibility Features section offered exactly: ${options.join(", ")}, as tick boxes with no free-text field.`);
  });

  test("[TC-US17-07] [US17-AC3] missing or invalid values show validation errors and nothing is saved", async ({ page }, info) => {
    await openCatalogue(page);
    await page.getByRole("button", { name: "+ Add Venue" }).click();

    // Nothing filled in.
    await page.getByRole("button", { name: "Save Venue" }).click();
    await expect(page.getByText("Enter the venue name.")).toBeVisible();
    await expect(page.getByText("Enter where the venue is.")).toBeVisible();
    await expect(page.getByText("Capacity must be a whole number greater than 0.")).toBeVisible();
    await expect(page.getByLabel("Venue name")).toBeVisible();

    // A non-positive capacity is also refused.
    await page.getByLabel("Venue name").fill(unique("Bad Room"));
    await page.getByLabel("Location", { exact: true }).fill("Nowhere");
    await page.getByLabel("Capacity").fill("0");
    await page.getByRole("button", { name: "Save Venue" }).click();
    await expect(page.getByText("Capacity must be a whole number greater than 0.")).toBeVisible();
    await expect(page.getByLabel("Venue name")).toBeVisible();
    observed(info, `Saving an empty form showed "Enter the venue name.", "Enter where the venue is." and "Capacity must be a whole number greater than 0."; a capacity of 0 showed the capacity error too. The form stayed open and no venue was added.`);
  });

  test("[TC-US17-08] [US17-AC5] each change is recorded with the editing user and a timestamp", async ({ page, baseURL }, info) => {
    const staff = await apiAs(baseURL!, DANIEL);
    const venue = await createVenue(staff, { cap: 200 });
    await openCatalogue(page);

    await catalogueCard(page, venue.name).getByRole("button", { name: "Edit" }).click();
    await page.getByLabel("Capacity").fill("260");
    await page.getByRole("button", { name: "Save Venue" }).click();
    await expect(toast(page)).toContainText(`${venue.name} updated.`);

    await expect(catalogueCard(page, venue.name).getByText(new RegExp(`Last changed by ${DANIEL.email}`))).toBeVisible();
    const history: Array<{ action: string; changed_by: string; changed_at: string; changes: Record<string, { old: unknown; new: unknown }> }> =
      await (await staff.get(`/api/venues/${venue.id}/history`)).json();
    expect(history.map((h) => h.action)).toEqual(["create", "edit"]);
    for (const entry of history) {
      expect(entry.changed_by).toBe(DANIEL.email);
      expect(Number.isNaN(Date.parse(entry.changed_at))).toBe(false);
    }
    expect(history[1].changes.cap).toEqual({ old: 200, new: 260 });
    observed(info, `The card showed "Last changed by ${DANIEL.email}" with a time. The venue's history listed "create" then "edit", both by ${DANIEL.email} with a timestamp, and the edit recorded capacity 200 -> 260.`);
  });

  test("[TC-US17-09] only Venue Staff can maintain the catalogue", async ({ page, baseURL }, info) => {
    const venue = await createVenue(await apiAs(baseURL!, DANIEL));
    const priya = await apiAs(baseURL!, PRIYA);

    // A coordinator can't change or add venues, and the catalogue page is not open to them.
    expect((await priya.put(`/api/venues/${venue.id}`, { data: { cap: 1 } })).status()).toBe(403);
    expect((await priya.post("/api/venues", { data: { name: "x", location: "y", cap: 1, setupMinutes: 0, turnaroundMinutes: 0 } })).status()).toBe(403);
    await signIn(page, PRIYA, /\/queue/);
    await page.goto("/catalogue");
    await expect(page).not.toHaveURL(/\/catalogue/);
    observed(info, `A coordinator's edit and add requests were refused with 403, and opening /catalogue redirected them to ${new URL(page.url()).pathname}.`);
  });
});
