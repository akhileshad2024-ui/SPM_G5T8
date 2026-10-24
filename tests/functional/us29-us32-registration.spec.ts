import { expect, test, type Page } from "@playwright/test";
import { apiAs, MAYA, SAM, ALEX, signIn, unique } from "./support/app";
import { seedScenario, scenarioNames, sql } from "./support/scenario";
import { readFile } from "node:fs/promises";

function setup() {
  const scenario = seedScenario(unique("registration"));
  return { id: scenario.symposium, name: scenarioNames(scenario).symposium };
}
function card(page: Page, name: string) {
  return page.locator(".card").filter({ has: page.getByText(name, { exact: true }) })
    .filter({ has: page.getByRole("button", { name: /^(Register|Join waitlist|Withdraw)$/ }) });
}

test("[FT-US29-01,02][FT-US30-01] registers once, confirms and survives reload", async ({ page, baseURL }) => {
  const e = setup();
  await signIn(page, SAM, /\/browse/);
  await card(page, e.name).getByRole("button", { name: "Register", exact: true }).click();
  await expect(card(page, e.name).getByRole("button", { name: "Withdraw", exact: true })).toBeVisible();
  await expect(page.locator(".cs-animate-toast")).toContainText(`Registered for ${e.name}`);
  const api = await apiAs(baseURL!, SAM);
  expect((await api.post(`/api/events/${e.id}/registrations`)).status()).toBe(409);
  await api.dispose();
  await page.reload();
  await expect(card(page, e.name)).toContainText("1 of 200 places taken");
  await expect(card(page, e.name)).toContainText("registered");
  const mine = page.locator("section").filter({ has: page.getByRole("heading", { name: "My registrations" }) });
  await expect(mine).toContainText(e.name);
  expect(sql("SELECT COUNT(*) FROM registrations WHERE event_id=?", [e.id])).toEqual([[1]]);
});

test("[FT-US29-03] a full event offers waitlist without consuming another place", async ({ page, baseURL }) => {
  const e = setup();
  sql("UPDATE events SET registration_cap=1 WHERE id=?", [e.id]);
  const taylor = await apiAs(baseURL!, { name: "Taylor Test", email: "taylor@student.connectsphere.edu" });
  expect((await taylor.post(`/api/events/${e.id}/registrations`)).status()).toBe(201);
  await taylor.dispose();
  await signIn(page, SAM, /\/browse/);
  await card(page, e.name).getByRole("button", { name: "Join waitlist", exact: true }).click();
  await expect(card(page, e.name)).toContainText("waitlisted");
  await expect(card(page, e.name)).toContainText("1 of 1 places taken");
});

test("[FT-US29-04] registration after closing is refused with a reason", async ({ page }) => {
  const e = setup();
  sql("UPDATE events SET registration_close=date('now','-2 day') WHERE id=?", [e.id]);
  await signIn(page, SAM, /\/browse/);
  await card(page, e.name).getByRole("button", { name: "Register", exact: true }).click();
  await expect(page.locator(".cs-animate-toast")).toContainText("has closed");
  expect(sql("SELECT COUNT(*) FROM registrations WHERE event_id=?", [e.id])).toEqual([[0]]);
});

test("[FT-US31-01,02] withdrawal needs confirmation and returns the place", async ({ page, baseURL }) => {
  const e = setup();
  const api = await apiAs(baseURL!, SAM);
  expect((await api.post(`/api/events/${e.id}/registrations`)).status()).toBe(201);
  await api.dispose();
  await signIn(page, SAM, /\/browse/);
  const event = card(page, e.name);
  await event.getByRole("button", { name: "Withdraw", exact: true }).click();
  await expect(event.getByText(`Withdraw your registration for ${e.name}?`, { exact: true })).toBeVisible();
  await event.getByRole("button", { name: "Keep registration" }).click();
  expect(sql("SELECT status FROM registrations WHERE event_id=?", [e.id])).toEqual([["registered"]]);
  await event.getByRole("button", { name: "Withdraw", exact: true }).click();
  await event.getByRole("button", { name: "Confirm withdrawal" }).click();
  await expect(event.getByRole("button", { name: "Register", exact: true })).toBeVisible();
  await expect(event).toContainText("0 of 200 places taken");
  await page.reload();
  expect(sql("SELECT status FROM registrations WHERE event_id=?", [e.id])).toEqual([["withdrawn"]]);
});

test("[FT-US31-03] withdrawal after its deadline is refused", async ({ page, baseURL }) => {
  const e = setup();
  const api = await apiAs(baseURL!, SAM);
  expect((await api.post(`/api/events/${e.id}/registrations`)).status()).toBe(201);
  await api.dispose();
  sql("UPDATE events SET registration_close=date('now','+2 day') WHERE id=?", [e.id]);
  await signIn(page, SAM, /\/browse/);
  await card(page, e.name).getByRole("button", { name: "Withdraw", exact: true }).click();
  await card(page, e.name).getByRole("button", { name: "Confirm withdrawal" }).click();
  await expect(page.locator(".cs-animate-toast")).toContainText("withdrawal deadline");
  expect(sql("SELECT status FROM registrations WHERE event_id=?", [e.id])).toEqual([["registered"]]);
});

test("[FT-US30-02][US30-AC3,4] cancelled registrations retain history and updated event details", async ({ page, baseURL }) => {
  const e = setup();
  const api = await apiAs(baseURL!, SAM);
  await api.post(`/api/events/${e.id}/registrations`);
  await api.dispose();
  sql("UPDATE events SET status='cancelled', start_time='15:00:00' WHERE id=?", [e.id]);
  await signIn(page, SAM, /\/browse/);
  const mine = page.locator("section").filter({ has: page.getByRole("heading", { name: "My registrations" }) });
  const row = mine.locator(".card > div").filter({ hasText: e.name });
  await expect(row).toContainText("cancelled");
  await expect(row).toContainText("15:00");
});

test("[FT-US32-01,02,03] organiser views, filters and exports saved registrations", async ({ page, baseURL }) => {
  const e = setup();
  const api = await apiAs(baseURL!, SAM);
  await api.post(`/api/events/${e.id}/registrations`);
  await api.dispose();
  await signIn(page, MAYA, /\/my-events/);
  await page.goto("/registrations");
  await page.getByLabel("Managed event").selectOption(`EVT-${e.id}`);
  await expect(page.getByRole("table")).toContainText(SAM.name);
  await expect(page.getByText("1 / 200 places filled", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: /^Status/ }).selectOption("withdrawn");
  await expect(page.getByText("No registrations match this filter.")).toBeVisible();
  await page.getByRole("combobox", { name: /^Status/ }).selectOption("registered");
  await expect(page.getByRole("table")).toContainText(SAM.name);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const download = await downloadPromise;
  const contents = await readFile((await download.path())!, "utf8");
  expect(contents).toContain(SAM.email);
  expect(contents).toContain('"registered"');
});

test("[FT-US32-04] another organiser cannot see or fetch registrations", async ({ page, baseURL }) => {
  const e = setup();
  await signIn(page, ALEX, /\/my-events/);
  await page.goto("/registrations");
  await expect(page.getByText(e.name, { exact: true })).toHaveCount(0);
  const api = await apiAs(baseURL!, ALEX);
  expect((await api.get(`/api/events/${e.id}/registrations`)).status()).toBe(403);
  await api.dispose();
});
