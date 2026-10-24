import { expect, test } from "@playwright/test";
import { apiAs, PRIYA, WEI, signIn, openInQueue, unique } from "./support/app";
import { seedScenario, scenarioNames, sql } from "./support/scenario";

function setup() {
  const s = seedScenario(unique("equipment"));
  sql("UPDATE events SET status = 'approved' WHERE id = ?", [s.symposium]);
  return { id: s.symposium, name: scenarioNames(s).symposium };
}

test.afterEach(() => {
  sql("UPDATE equipment_stock SET maintenance=0, out_of_service=0 WHERE id='E2'");
});

test("[US25-AC1,2,3] coordinator records, edits, removes and validates equipment", async ({ page }) => {
  const e = setup();
  await signIn(page, PRIYA, /\/queue/);
  await openInQueue(page, e.name);
  await page.getByRole("button", { name: "Equipment", exact: true }).click();
  await page.getByLabel("Assigned technician").selectOption({ label: WEI.name });
  await page.getByLabel("Quantity 1", { exact: true }).fill("0");
  await page.getByRole("button", { name: "Submit equipment request" }).click();
  await expect(page.getByRole("status")).toContainText("greater than 0");
  await page.getByLabel("Quantity 1", { exact: true }).fill("3");
  await page.getByLabel("Technical requirements 1").fill("HDMI and adapter");
  await page.getByRole("button", { name: "Add equipment" }).click();
  await expect(page.getByLabel("Equipment type 2")).toBeVisible();
  await page.getByRole("button", { name: "Remove line 2" }).click();
  await page.getByRole("button", { name: "Submit equipment request" }).click();
  await expect(page.getByRole("status")).toHaveText("Equipment saved.");
  await page.reload();
  await openInQueue(page, e.name);
  await page.getByRole("button", { name: "Equipment", exact: true }).click();
  await expect(page.getByLabel("Quantity 1", { exact: true })).toHaveValue("3");
  await expect(page.getByLabel("Technical requirements 1")).toHaveValue("HDMI and adapter");
});

test("[US26-AC1,2,3,5][US27-AC1,2,3,4][US28-AC1,2,3,4,5] assigned technician checks, reserves, amends and releases", async ({ page, baseURL }) => {
  const e = setup();
  sql("UPDATE equipment_stock SET maintenance=1, out_of_service=1 WHERE id='E2'");
  await signIn(page, WEI, /\/equipment/);
  await page.getByLabel("Assigned event").selectOption(String(e.id));
  const manager = page.getByRole("region", { name: "Equipment request" });
  await expect(page.getByLabel("Quantity 1", { exact: true })).toHaveValue("2");
  await expect(manager).toContainText("4 available of 6");
  await page.getByLabel("Quantity 1", { exact: true }).fill("5");
  await page.getByLabel("Status 1", { exact: true }).selectOption("reserved");
  await page.getByRole("button", { name: "Save line 1" }).click();
  await expect(page.getByRole("status")).toContainText("Insufficient equipment");
  await page.getByLabel("Quantity 1", { exact: true }).fill("3");
  await page.getByLabel("Notes 1").fill("Prepared in store");
  await page.getByLabel("Alternative 1").fill("Portable projector");
  await page.getByRole("button", { name: "Save line 1" }).click();
  await expect(page.getByRole("status")).toHaveText("Equipment saved.");
  expect(sql("SELECT quantity FROM equipment_reservations WHERE event_id=? AND item_id='E2'", [e.id])).toEqual([[3]]);
  const second = setup();
  const api = await apiAs(baseURL!, PRIYA);
  const response = await api.get(`/api/events/${second.id}/equipment`);
  expect((await response.json()).availability.find((s: {id: string}) => s.id === "E2").available).toBe(1);
  await api.dispose();
  await page.reload();
  await page.getByLabel("Assigned event").selectOption(String(e.id));
  await expect(page.getByLabel("Notes 1")).toHaveValue("Prepared in store");
  await page.getByLabel("Quantity 1", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Save line 1" }).click();
  await expect(page.getByRole("status")).toHaveText("Equipment saved.");
  expect(sql("SELECT quantity FROM equipment_reservations WHERE event_id=?", [e.id])).toEqual([[2]]);
  await page.getByLabel("Status 1", { exact: true }).selectOption("pending");
  await page.getByRole("button", { name: "Save line 1" }).click();
  await expect(page.getByRole("status")).toHaveText("Equipment saved.");
  expect(sql("SELECT quantity FROM equipment_reservations WHERE event_id=?", [e.id])).toEqual([]);
  await page.getByText("Equipment update history", { exact: true }).click();
  await expect(manager).toContainText(WEI.name);
  sql("UPDATE equipment_stock SET maintenance=0, out_of_service=0 WHERE id='E2'");
});
