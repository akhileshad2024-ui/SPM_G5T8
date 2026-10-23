import { expect, test, type Page } from "@playwright/test";
import { PRIYA, apiAs, openInQueue, signIn, toast, unique } from "./support/app";
import { DANIEL, createVenue, dateLabel, eventFor, futureDate, observed, openVenueTab, resultCard } from "./support/venues";

/**
 * US21 — Check Venue Suitability (functional).
 * "As an Event Coordinator, I want to see whether a venue meets an event's requirements and why
 * it may be unsuitable so that I can avoid selecting an inappropriate venue."
 *
 * Every test makes its own venues and its own approved event: a 120-person theatre event on
 * a future date, 10:00-12:00, needing a projector and wheelchair access.
 *
 * Test cases: tests/functional/report/test_cases.py.
 */
const EVENT = { attendance: 120, layout: "theatre", facilities: ["Projector"], accessibility: ["Wheelchair Access"] };

/** Given three venues: one that fits, one that only lacks the projector, one that is too small. */
async function threeVenues(baseURL: string) {
  const staff = await apiAs(baseURL, DANIEL);
  const common = { layouts: ["theatre"], accessibility: ["Wheelchair Access"] };
  return {
    fits: await createVenue(staff, { name: unique("Fitting Hall"), cap: 200, facilities: ["Projector", "PA system"], ...common }),
    noProjector: await createVenue(staff, { name: unique("No Projector Hall"), cap: 200, facilities: ["PA system"], ...common }),
    tooSmall: await createVenue(staff, { name: unique("Small Hall"), cap: 50, facilities: ["Projector"], ...common }),
  };
}

/** The coordinator opens the event's Venue tab, with every venue shown. */
async function openEventVenues(page: Page, eventName: string) {
  await signIn(page, PRIYA, /\/queue/);
  await openInQueue(page, eventName);
  await openVenueTab(page);
}

test.describe("US21 - Check Venue Suitability", () => {
  test("[TC-US21-01] [US21-AC1] each candidate venue is marked suitable, partially suitable or unsuitable", async ({ page, baseURL }, info) => {
    const venues = await threeVenues(baseURL!);
    const event = unique("Design Keynote");
    await eventFor(baseURL!, event, EVENT);

    await openEventVenues(page, event);

    await expect(resultCard(page, venues.fits.name).locator(".pill").first()).toHaveText("Suitable");
    await expect(resultCard(page, venues.noProjector.name).locator(".pill").first()).toHaveText("Partially suitable");
    await expect(resultCard(page, venues.tooSmall.name).locator(".pill").first()).toHaveText("Unsuitable");
    observed(info, `${venues.fits.name} (meets every need) was marked Suitable; ${venues.noProjector.name} (no projector) was marked Partially suitable; ${venues.tooSmall.name} (capacity 50 for 120 people) was marked Unsuitable.`);
  });

  test("[TC-US21-02] [US21-AC2] every unmet requirement is shown with the reason", async ({ page, baseURL }, info) => {
    const staff = await apiAs(baseURL!, DANIEL);
    const weak = await createVenue(staff, { name: unique("Weak Hall"), cap: 50, layouts: ["banquet"], facilities: [], accessibility: [] });
    const event = unique("Design Keynote");
    await eventFor(baseURL!, event, EVENT);

    await openEventVenues(page, event);

    const card = resultCard(page, weak.name);
    await expect(card.locator(".pill").first()).toHaveText("Unsuitable");
    for (const reason of [
      "Capacity 50 is below the expected attendance of 120.",
      "Does not support a theatre layout.",
      "Projector is not available at this venue.",
      "Wheelchair Access is not provided at this venue.",
    ]) {
      await expect(card.getByText(reason, { exact: true })).toBeVisible();
    }
    observed(info, `${weak.name} listed four reasons: "Capacity 50 is below the expected attendance of 120.", "Does not support a theatre layout.", "Projector is not available at this venue." and "Wheelchair Access is not provided at this venue."`);
  });

  test("[TC-US21-03] [US21-AC3] the comparison with the event's recorded venue needs can be seen", async ({ page, baseURL }, info) => {
    const venues = await threeVenues(baseURL!);
    const event = unique("Design Keynote");
    const date = futureDate();
    await eventFor(baseURL!, event, { ...EVENT, date });

    await openEventVenues(page, event);

    const card = resultCard(page, venues.tooSmall.name);
    await card.getByText("Compared with this event's venue needs").click();
    const row = (label: string) => card.locator("tr", { hasText: label });
    await expect(row("Capacity")).toContainText("120 people");
    await expect(row("Capacity")).toContainText("50 people");
    await expect(row("Capacity")).toContainText("No");
    await expect(row("Layout")).toContainText("Theatre");
    await expect(row("Facility: Projector")).toContainText("Available");
    await expect(row("Accessibility: Wheelchair Access")).toContainText("Provided");
    await expect(row("Availability")).toContainText(`${dateLabel(date)}, 10:00–12:00`);
    observed(info, `The comparison table for ${venues.tooSmall.name} listed Capacity (needs 120 people, offers 50 people, not met), Layout, Facility: Projector, Accessibility: Wheelchair Access and Availability for ${dateLabel(date)}, 10:00-12:00, each with what the event needs and what the venue offers.`);
  });

  test("[TC-US21-04] [US21-AC4] the coordinator can still request an unsuitable venue after acknowledging the warning", async ({ page, baseURL }, info) => {
    const venues = await threeVenues(baseURL!);
    const event = unique("Design Keynote");
    await eventFor(baseURL!, event, EVENT);
    await openEventVenues(page, event);

    const card = resultCard(page, venues.tooSmall.name);
    await card.getByRole("button", { name: "Request anyway…" }).click();
    await expect(card.getByText(`${venues.tooSmall.name} is unsuitable for this event.`)).toBeVisible();
    const proceed = card.getByRole("button", { name: "Request booking anyway" });
    await expect(proceed).toBeDisabled(); // not until the warning is acknowledged
    await card.getByLabel(/I acknowledge the warning/).check();
    await expect(proceed).toBeEnabled();
    await proceed.click();

    await expect(toast(page)).toContainText(`Booking requested at ${venues.tooSmall.name}.`);
    await expect(card.getByRole("button", { name: "Requested", exact: true })).toBeVisible();
    observed(info, `"Request booking anyway" stayed disabled until the acknowledgement box was ticked; after ticking it the toast said "Booking requested at ${venues.tooSmall.name}." and the venue's button changed to Requested.`);
  });

  test("[TC-US21-05] [US21-AC5] the override is recorded against the event", async ({ page, baseURL }, info) => {
    const venues = await threeVenues(baseURL!);
    const event = unique("Design Keynote");
    await eventFor(baseURL!, event, EVENT);
    await openEventVenues(page, event);

    const card = resultCard(page, venues.noProjector.name);
    await card.getByRole("button", { name: "Request anyway…" }).click();
    await card.getByLabel(/I acknowledge the warning/).check();
    await card.getByRole("button", { name: "Request booking anyway" }).click();
    await expect(toast(page)).toContainText(`Booking requested at ${venues.noProjector.name}.`);

    // The Venue tab now lists the override, and the Activity tab logs it.
    await expect(page.getByText("Overrides recorded against this event")).toBeVisible();
    await expect(page.getByText("Projector is not available at this venue.").first()).toBeVisible();
    await page.getByRole("button", { name: "Activity", exact: true }).click();
    await expect(page.getByText("Venue override acknowledged")).toBeVisible();
    await expect(page.getByText(/went ahead with .*which is partially suitable/)).toBeVisible();
    observed(info, `After proceeding with ${venues.noProjector.name} (partially suitable), the Venue tab showed "Overrides recorded against this event" with the reason "Projector is not available at this venue.", and the Activity tab logged "Venue override acknowledged".`);
  });

  test("[TC-US21-06] [US21-AC5] the recorded override is still there after the page is reloaded", async ({ page, baseURL }, info) => {
    const venues = await threeVenues(baseURL!);
    const event = unique("Design Keynote");
    await eventFor(baseURL!, event, EVENT);
    await openEventVenues(page, event);
    const card = resultCard(page, venues.noProjector.name);
    await card.getByRole("button", { name: "Request anyway…" }).click();
    await card.getByLabel(/I acknowledge the warning/).check();
    await card.getByRole("button", { name: "Request booking anyway" }).click();
    await expect(toast(page)).toContainText(`Booking requested at ${venues.noProjector.name}.`);

    await page.reload();
    await openInQueue(page, event);
    await openVenueTab(page);

    await expect(page.getByText("Overrides recorded against this event")).toBeVisible();
    await expect(page.getByText("Projector is not available at this venue.").first()).toBeVisible();
    observed(info, `After reloading the page and reopening the event, the Venue tab still showed "Overrides recorded against this event" with the reason "Projector is not available at this venue."`);
  });
});
