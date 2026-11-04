import { expect, test } from "@playwright/test";
import { apiAs, MAYA, PRIYA, WEI, SAM, HANNAH, signIn, openInQueue } from "./support/app";
import { readyEvent, sendToCheck, decideVia, safetyCard } from "./support/safety";
import { observed } from "./support/venues";

test.describe("Yangbo Sprint 4 reassessment", () => {
  test.setTimeout(120_000);

  test("[FT50-01][FT50-03][US50-AC1,2,3] accepted reviewed equipment values flag and notify without applying", async ({ page, browser, baseURL }, info) => {
    const event = await readyEvent(baseURL!, "US50 reviewed equipment");
    const tech = await apiAs(baseURL!, WEI);
    const techId = (await (await tech.get("/api/auth/me")).json()).id;
    expect((await event.priya.put(`/api/events/${event.eventId}/equipment`, { data: {techId, lines: [{id:"E1",qty:1,technicalRequirements:""}]} })).ok()).toBeTruthy();
    expect((await tech.patch(`/api/events/${event.eventId}/equipment/E1`, { data: {status:"reserved"} })).ok()).toBeTruthy();
    const owner = await apiAs(baseURL!, MAYA);
    const proposal = await owner.post(`/api/events/${event.eventId}/change-requests`, { data: {proposed_changes:"Use two wireless microphones"} });
    expect(proposal.status()).toBe(201);
    const requestId = (await proposal.json()).id;
    await signIn(page, PRIYA, /\/queue/);
    await openInQueue(page, event.name);
    await page.getByText("Reviewed values for reassessment (optional)", {exact:true}).click();
    await page.getByLabel("Replace equipment requirements for review").check();
    await page.getByLabel("Wireless microphone reviewed quantity").fill("2");
    await page.getByRole("button", {name:"Accept change request", exact:true}).click();
    await expect(page.getByLabel("Accepted change reassessment")).toContainText("Equipment reservations checked: 1");
    const panel = page.getByRole("region", {name:"Arrangement reassessments", exact:true});
    await expect(panel).toContainText("Requires Reassessment");
    const current = await (await event.priya.get(`/api/events/${event.eventId}`)).json();
    expect(current.equip[0].qty).toBe(1);
    const notices = await (await tech.get("/api/notifications")).json();
    expect(notices.some((notice: {title:string;body:string}) => notice.title === "Equipment requires reassessment" && notice.body.includes("reservation #") && notice.body.includes(event.name))).toBeTruthy();
    await page.reload(); await openInQueue(page, event.name);
    await expect(panel).toContainText("Requires Reassessment");
    // Explicit release and apply are separate real operations, not acceptance effects.
    expect((await tech.patch(`/api/events/${event.eventId}/equipment/E1`, {data:{status:"pending"}})).ok()).toBeTruthy();
    await page.getByRole("button", {name:`Apply reviewed changes #${requestId}`, exact:true}).click();
    await expect(page.getByRole("button", {name:`Apply reviewed changes #${requestId}`, exact:true})).toHaveCount(0);
    const context = await browser.newContext();
    const techPage = await context.newPage();
    await signIn(techPage, WEI, /\/equipment/);
    await techPage.getByLabel("Assigned event").selectOption(String(event.eventId));
    await expect(techPage.getByLabel("Quantity 1", {exact:true})).toHaveValue("2");
    await techPage.getByLabel("Status 1", {exact:true}).selectOption("reserved");
    await techPage.getByRole("button", {name:"Save line 1", exact:true}).click();
    await expect(techPage.getByRole("status")).toHaveText("Equipment saved.");
    const techPanel = techPage.getByRole("region", {name:"equipment reassessments", exact:true});
    await techPanel.getByLabel("Resolution evidence").fill("Two microphones reserved and checked");
    await techPanel.getByRole("button", {name:/Resolve reassessment/}).click();
    await expect(techPanel).toContainText("Resolved: Two microphones reserved and checked");
    observed(info, `US50 event ${event.eventId}, request ${requestId}: accepted snapshot retained qty 1, flagged/notified, explicit release/apply then technician reserved qty 2 and resolved through UI.`);
    await context.close();
    await tech.patch(`/api/events/${event.eventId}/equipment/E1`, {data:{status:"pending"}});
  });

  test("[FT51-01][FT51-03][US51-AC1,2,3] registration flag and affected registered attendee notification", async ({ page, baseURL }, info) => {
    const event = await readyEvent(baseURL!, "US51 registration review");
    expect((await event.priya.patch(`/api/events/${event.eventId}/details`, {data:{reg:true,regCap:1}})).ok()).toBeTruthy();
    await sendToCheck(event.priya, event.eventId);
    await decideVia(await apiAs(baseURL!, HANNAH), event.eventId, "approved");
    expect((await event.priya.post(`/api/events/${event.eventId}/confirm`)).ok()).toBeTruthy();
    const attendee = await apiAs(baseURL!, SAM);
    expect((await attendee.post(`/api/events/${event.eventId}/registrations`)).status()).toBe(201);
    const owner = await apiAs(baseURL!, MAYA);
    const created = await owner.post(`/api/events/${event.eventId}/change-requests`, {data:{proposed_changes:"Review disabled registration"}});
    const requestId = (await created.json()).id;
    await signIn(page, PRIYA, /\/queue/); await openInQueue(page, event.name);
    await page.getByText("Reviewed values for reassessment (optional)", {exact:true}).click();
    await page.getByLabel("Reviewed registration", {exact:true}).selectOption("false");
    await page.getByRole("button", {name:"Accept change request", exact:true}).click();
    const panel = page.getByRole("region", {name:"Arrangement reassessments", exact:true});
    await expect(panel).toContainText("registration");
    await expect(panel).toContainText("Requires Reassessment");
    const notices = await (await attendee.get("/api/notifications")).json();
    expect(notices.some((notice:{title:string;body:string}) => notice.title === "Event changed" && notice.body.includes(event.name))).toBeTruthy();
    expect((await (await event.priya.get(`/api/events/${event.eventId}`)).json()).reg).toBe(true);
    await page.getByRole("button", {name:`Apply reviewed changes #${requestId}`, exact:true}).click();
    await expect(page.getByRole("button", {name:`Apply reviewed changes #${requestId}`, exact:true})).toHaveCount(0);
    expect((await event.priya.patch(`/api/events/${event.eventId}/details`, {data:{reg:true}})).ok()).toBeTruthy();
    await page.reload(); await openInQueue(page, event.name);
    await panel.getByLabel("Resolution evidence").fill("Registration restored; existing attendee retained");
    await panel.getByRole("button", {name:/Resolve reassessment/}).click();
    await expect(panel).toContainText("Resolved: Registration restored; existing attendee retained");
    observed(info, `US51 event ${event.eventId}, request ${requestId}: registered attendee notified; settings retained at acceptance; disabled setting flagged; explicit apply/correction then UI resolution. No attendee cancelled.`);
  });

  for (const outcome of ["rejected", "changes_requested"] as const) {
    test(`[FT45-01][FT45-03][FT45-04][US45-AC1,2,3,4] ${outcome} named venue rework to preparation and confirmation`, async ({ page, browser, baseURL }, info) => {
      const event = await readyEvent(baseURL!, `US45 ${outcome}`);
      await sendToCheck(event.priya, event.eventId);
      await signIn(page, HANNAH, /\/safety/);
      const card = safetyCard(page, event.name);
      await card.getByRole("checkbox", {name:/Reassess/}).check();
      await card.getByLabel("Comment", {exact:true}).fill("Clear the aisle and review the venue arrangement");
      await card.getByRole("button", {name:outcome === "rejected" ? "Reject" : "Request changes",exact:true}).click();
      await expect(card).toHaveCount(0);
      const context = await browser.newContext(); const coordinator = await context.newPage();
      await signIn(coordinator, PRIYA, /\/queue/); await openInQueue(coordinator, event.name);
      const panel = coordinator.getByRole("region", {name:"Arrangement reassessments",exact:true});
      await expect(panel).toContainText("Returned to venue planning");
      await expect(coordinator.getByRole("button", {name:"Edit event details",exact:true})).toBeEnabled();
      expect((await event.priya.post(`/api/events/${event.eventId}/safety-check/request`)).status()).toBe(409);
      expect((await event.priya.post(`/api/events/${event.eventId}/preparation`)).status()).toBe(409);
      expect((await event.priya.post(`/api/events/${event.eventId}/confirm`)).status()).toBe(409);
      await panel.getByLabel("Resolution evidence").fill("Venue aisle revised and checked");
      await panel.getByRole("button", {name:/Resolve reassessment/}).click();
      await expect(panel).toContainText("Resolved: Venue aisle revised and checked");
      await coordinator.getByRole("button", {name:"Request safety check",exact:true}).click();
      await page.reload();
      await safetyCard(page, event.name).getByRole("button", {name:"Approve",exact:true}).click();
      await coordinator.reload(); await openInQueue(coordinator, event.name);
      await panel.getByRole("button", {name:"Start preparation",exact:true}).click();
      await expect(panel).toContainText("Preparation started");
      await coordinator.getByRole("button", {name:"Confirm event",exact:true}).click();
      await expect(coordinator.getByLabel("Confirmation",{exact:true})).toContainText("Confirmed by");
      observed(info, `US45 ${outcome}, event ${event.eventId}: named venue only, planning editor enabled, direct gates refused, resolved, reviewed again, preparation and confirmation completed through browser.`);
      await context.close();
    });
  }
});
