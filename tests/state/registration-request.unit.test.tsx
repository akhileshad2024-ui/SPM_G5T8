// @vitest-environment jsdom
/**
 * lib/state/app-context.tsx: attendee registration and withdrawal, and the organiser's request
 * wizard (new request, editing a draft, the form fields, saving a draft, submitting).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PEOPLE } from "../../lib/data/seed";
import { EQUIP } from "../../lib/data/options";
import type { StoredEvent } from "../../lib/events/request/api";
import { resetNext, router } from "../helpers/next-mocks";
import { act2, bodies, called, fail, flush, mountApp, resetApi, route, stored } from "./harness";

vi.mock("next/navigation", async () => (await import("../helpers/next-mocks")).nextNavigation);
vi.mock("../../lib/api/client", async (original) => ({
  ...(await original<typeof import("../../lib/api/client")>()),
  apiFetch: (await import("./api-mock")).apiFetch,
}));
vi.mock("../../lib/auth/idle-timeout", async (original) => ({
  ...(await original<typeof import("../../lib/auth/idle-timeout")>()),
  useIdleSignOut: (await import("./api-mock")).useIdleSignOutSpy,
}));

beforeEach(() => {
  resetApi();
  resetNext();
});

const unstored = (overrides: Partial<StoredEvent> = {}) => stored(1, { id: undefined as unknown as number, ...overrides });

function registrationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 4, eventId: 1, eventName: "Event 1", eventDate: "2026-11-26", eventStart: "18:30:00", eventEnd: "21:00:00",
    attendeeName: "Sam Adeyemi", attendeeEmail: PEOPLE.attendee.email, status: "registered",
    registeredAt: "2026-10-01T00:00:00Z", updatedAt: "2026-10-01T00:00:00Z", ...overrides,
  };
}

/** A confirmed event open for registration, far in the future. */
const open = (overrides: Partial<StoredEvent> = {}) =>
  stored(1, { status: "confirmed", reg: true, regCap: 100, registered: 10, regClose: "2099-01-01", ...overrides });

describe("registerForEvent", () => {
  const setup = (event: StoredEvent = open(), rows: unknown[] = []) =>
    mountApp({ role: "attendee", events: [event], routes: { "GET /registrations/me": rows } });

  it("does nothing for an event it doesn't have or that was never stored", async () => {
    const m = await setup();
    await act2(() => m.app.registerForEvent("EVT-9"));

    const sample = await setup(unstored({ status: "confirmed", reg: true }));
    await act2(() => sample.app.registerForEvent("EVT-undefined"));

    expect(called("POST /events/1/registrations")).toBe(0);
  });

  it("explains, without calling the server, that registration isn't open", async () => {
    const m = await setup(open({ status: "approved" }));

    await act2(() => m.app.registerForEvent("EVT-1"));

    expect(m.app.state).toMatchObject({ toast: "Registration is not open for this event.", toastKind: "warn" });
    expect(called("POST /events/1/registrations")).toBe(0);
  });

  it("refuses someone who already has a registration", async () => {
    const m = await setup(open(), [registrationRow()]);

    await act2(() => m.app.registerForEvent("EVT-1"));

    expect(m.app.state.toast).toBe("You already have a registered registration for Event 1.");
  });

  it("registers, reloads the events and the registrations, and says a confirmation email is queued", async () => {
    const m = await setup();
    route("POST /events/1/registrations", registrationRow());

    await act2(() => m.app.registerForEvent("EVT-1"));

    expect(called("POST /events/1/registrations")).toBe(1);
    expect(called("GET /events")).toBe(2);
    expect(called("GET /registrations/me")).toBe(2);
    expect(m.app.state.toast).toBe("Registered for Event 1. Confirmation email queued.");
  });

  it("says the event is full when the server waitlisted the attendee", async () => {
    const m = await setup(open({ registered: 100 }));
    route("POST /events/1/registrations", registrationRow({ status: "waitlisted" }));

    await act2(() => m.app.registerForEvent("EVT-1"));

    expect(m.app.state.toast).toBe("Event 1 is full. You have been waitlisted.");
  });

  it("shows the server's reason on a 409, and any other failure as an error", async () => {
    const m = await setup();
    fail("POST /events/1/registrations", 409, "Registration just closed");
    await act2(() => m.app.registerForEvent("EVT-1"));
    expect(m.app.state).toMatchObject({ toast: "Registration just closed", toastKind: "warn" });

    fail("POST /events/1/registrations", 500, "Down");
    await act2(() => m.app.registerForEvent("EVT-1"));
    expect(m.app.state).toMatchObject({ toast: "Down", toastKind: "bad" });
  });
});

describe("withdrawRegistration", () => {
  const setup = (event: StoredEvent = open(), rows: unknown[] = [registrationRow()]) =>
    mountApp({ role: "attendee", events: [event], routes: { "GET /registrations/me": rows } });

  it("says there is no active registration for an event it doesn't have or that was never stored", async () => {
    const m = await setup();
    await act2(() => m.app.withdrawRegistration("EVT-9"));
    expect(m.app.state.toast).toBe("No active registration was found.");

    const sample = await setup(unstored({ status: "confirmed" }));
    await act2(() => sample.app.withdrawRegistration("EVT-undefined"));
    expect(sample.app.state).toMatchObject({ toast: "No active registration was found.", toastKind: "warn" });
  });

  it("says so when the attendee isn't registered, or already withdrew", async () => {
    const none = await setup(open(), []);
    await act2(() => none.app.withdrawRegistration("EVT-1"));
    expect(none.app.state.toast).toBe("No active registration was found.");

    const withdrawn = await setup(open(), [registrationRow({ status: "withdrawn" })]);
    await act2(() => withdrawn.app.withdrawRegistration("EVT-1"));
    expect(withdrawn.app.state.toast).toBe("No active registration was found.");
    expect(called("DELETE /events/1/registrations/me")).toBe(0);
  });

  it("refuses once the withdrawal deadline has passed", async () => {
    const m = await setup(open({ withdrawalClose: "2020-01-01" }));

    await act2(() => m.app.withdrawRegistration("EVT-1"));

    expect(m.app.state).toMatchObject({ toast: "The withdrawal deadline for Event 1 has passed.", toastKind: "warn" });
    expect(called("DELETE /events/1/registrations/me")).toBe(0);
  });

  it("withdraws, reloads, adds a notice on the page and says the withdrawal is recorded", async () => {
    const m = await setup();
    route("DELETE /events/1/registrations/me", registrationRow({ status: "withdrawn" }));

    await act2(() => m.app.withdrawRegistration("EVT-1"));

    expect(called("DELETE /events/1/registrations/me")).toBe(1);
    expect(called("GET /events")).toBe(2);
    expect(m.app.state).toMatchObject({ toast: "Withdrawal recorded for Event 1.", toastKind: "warn" });
    expect(m.app.state.notifs.map((n) => n.title)).toEqual(["Registration withdrawn"]);
  });

  it("shows the server's reason on a 409, and any other failure as an error", async () => {
    const m = await setup();
    fail("DELETE /events/1/registrations/me", 409, "Too late");
    await act2(() => m.app.withdrawRegistration("EVT-1"));
    expect(m.app.state).toMatchObject({ toast: "Too late", toastKind: "warn" });

    fail("DELETE /events/1/registrations/me", 500, "Down");
    await act2(() => m.app.withdrawRegistration("EVT-1"));
    expect(m.app.state).toMatchObject({ toast: "Down", toastKind: "bad" });
  });
});

describe("the request wizard's form", () => {
  it("changes a field", async () => {
    const m = await mountApp({ role: "organiser" });

    await act2(() => m.app.setFormField("name", "Gala"));

    expect(m.app.state.form.name).toBe("Gala");
  });

  it("adds a facility and removes it again", async () => {
    const m = await mountApp({ role: "organiser" });

    await act2(() => m.app.toggleFormList("facilities", "Projector"));
    expect(m.app.state.form.facilities).toEqual(["PA system", "Projector"]);

    await act2(() => m.app.toggleFormList("facilities", "PA system"));
    expect(m.app.state.form.facilities).toEqual(["Projector"]);
  });

  it("raises and lowers the equipment requested, never below none or above what exists", async () => {
    const m = await mountApp({ role: "organiser" });
    const item = EQUIP[0];

    await act2(() => m.app.bumpEquip(item.id, -1));
    expect(m.app.state.form.equip[item.id]).toBe(0);

    await act2(() => m.app.bumpEquip(item.id, 1));
    expect(m.app.state.form.equip[item.id]).toBe(1);

    await act2(() => m.app.bumpEquip(item.id, item.total + 5));
    expect(m.app.state.form.equip[item.id]).toBe(item.total);

    await act2(() => m.app.bumpEquip("NOT-AN-ITEM", 3));
    expect(m.app.state.form.equip["NOT-AN-ITEM"]).toBe(0);
  });

  it("moves between steps, staying within the first and the last", async () => {
    const m = await mountApp({ role: "organiser" });

    await act2(() => m.app.backStep());
    expect(m.app.state.step).toBe(1);

    await act2(() => m.app.nextStep());
    expect(m.app.state.step).toBe(2);
    await act2(() => m.app.backStep());
    expect(m.app.state.step).toBe(1);
  });
});

describe("beginNewRequest", () => {
  const draft = (overrides: Partial<StoredEvent> = {}) => stored(1, { status: "draft", ...overrides });

  it("opens an empty form on the new-request page", async () => {
    const m = await mountApp({ role: "organiser" });
    await act2(() => m.app.setFormField("name", "Old text"));

    await act2(() => m.app.beginNewRequest());

    expect(m.app.state).toMatchObject({ step: 1, formErrors: {}, editingEventId: null });
    expect(m.app.state.form.name).toBe("");
    expect(router.push).toHaveBeenCalledWith("/new-request");
  });

  it("does nothing for a draft it doesn't have or that was never stored", async () => {
    const m = await mountApp({ role: "organiser", events: [unstored({ status: "draft" })] });

    await act2(() => m.app.beginNewRequest("EVT-9"));
    await act2(() => m.app.beginNewRequest("EVT-undefined"));

    expect(router.push).not.toHaveBeenCalled();
  });

  it("reloads a saved draft into the form for editing", async () => {
    const m = await mountApp({ role: "organiser", events: [draft()] });
    route("GET /event-requests/drafts/1", { id: 1, submitted_at: null, draft_form: { name: "Saved gala", pax: "80" } });

    await act2(() => m.app.beginNewRequest("EVT-1"));

    expect(m.app.state.editingEventId).toBe("EVT-1");
    expect(m.app.state.form).toMatchObject({ name: "Saved gala", pax: "80", start: "18:00" });
    expect(router.push).toHaveBeenCalledWith("/new-request");
  });

  it("shows the error when the draft can't be loaded", async () => {
    const m = await mountApp({ role: "organiser", events: [draft()] });
    fail("GET /event-requests/drafts/1", 403, "no");

    await act2(() => m.app.beginNewRequest("EVT-1"));

    expect(m.app.state.toast).toBe("You don't have permission to do that.");
    expect(router.push).not.toHaveBeenCalled();
  });
});

describe("saveDraft", () => {
  it("saves a new draft, adds it to the organiser's events and goes to My events", async () => {
    const m = await mountApp({ role: "organiser" });
    route("POST /event-requests/drafts", { id: 11, submitted_at: null });
    await act2(() => m.app.setFormField("name", "  Gala  "));
    await act2(() => m.app.setFormField("date", "2026-12-01"));
    await act2(() => m.app.setFormField("pax", "80"));

    await act2(() => m.app.saveDraft());

    const [body] = bodies("POST /event-requests/drafts") as Array<Record<string, unknown>>;
    expect(body.event_information).toMatchObject({ name: "  Gala  " });
    expect(body).not.toHaveProperty("draft_id");
    expect(m.app.state.events[0]).toMatchObject({ id: "EVT-11", backendId: 11, name: "Gala", status: "draft", pax: 80, organiser: "Maya Rahman" });
    expect(m.app.state.events[0].draftForm?.name).toBe("  Gala  ");
    expect(m.app.state.form.name).toBe("");
    expect(m.app.state.toast).toBe("Draft saved. You can finish it later.");
    expect(router.push).toHaveBeenCalledWith("/my-events");
    expect(m.app.isSavingDraft).toBe(false);
  });

  it("saves an empty draft with placeholder text and an unconfirmed date", async () => {
    const m = await mountApp({ role: "organiser" });
    route("POST /event-requests/drafts", { id: 12, submitted_at: null });

    await act2(() => m.app.saveDraft());

    expect(m.app.state.events[0]).toMatchObject({ name: "Untitled request", purpose: "No description provided yet.", date: "Date to confirm", pax: 0 });
  });

  it("updates the stored draft when editing one", async () => {
    const m = await mountApp({ role: "organiser", events: [stored(1, { status: "draft" })] });
    route("GET /event-requests/drafts/1", { id: 1, submitted_at: null, draft_form: { name: "Saved gala" } });
    route("PUT /event-requests/drafts/1", { id: 1, submitted_at: null });
    await act2(() => m.app.beginNewRequest("EVT-1"));

    await act2(() => m.app.saveDraft());

    expect(called("PUT /event-requests/drafts/1")).toBe(1);
    expect(m.app.state.events.filter((e) => e.id === "EVT-1")).toHaveLength(1);
  });

  it("shows field errors from the server and doesn't leave the page", async () => {
    const m = await mountApp({ role: "organiser" });
    fail("POST /event-requests/drafts", 422, "Name is required", { name: "Name is required" });

    await act2(() => m.app.saveDraft());

    expect(m.app.state.formErrors).toEqual({ name: "Name is required" });
    expect(m.app.state).toMatchObject({ toast: "Name is required", toastKind: "warn" });
    expect(router.push).not.toHaveBeenCalled();
    expect(m.app.isSavingDraft).toBe(false);
  });

  it("shows any other failure and can be tried again", async () => {
    const m = await mountApp({ role: "organiser" });
    fail("POST /event-requests/drafts", 500, "Could not save");

    await act2(() => m.app.saveDraft());
    expect(m.app.state.toast).toBe("Could not save");

    route("POST /event-requests/drafts", { id: 13, submitted_at: null });
    await act2(() => m.app.saveDraft());
    expect(m.app.state.events.map((e) => e.id)).toEqual(["EVT-13"]);
  });

  it("ignores a second click while the first save is in progress", async () => {
    const m = await mountApp({ role: "organiser" });
    let release!: () => void;
    route("POST /event-requests/drafts", () => new Promise((resolve) => { release = () => resolve({ id: 14, submitted_at: null }); }));

    await act2(async () => {
      void m.app.saveDraft();
      await flush();
    });
    expect(m.app.isSavingDraft).toBe(true);
    await act2(() => m.app.saveDraft());
    await act2(async () => { release(); await flush(); });

    expect(called("POST /event-requests/drafts")).toBe(1);
  });
});

describe("submitting the request", () => {
  const toLastStep = async (m: Awaited<ReturnType<typeof mountApp>>) => {
    await act2(() => m.app.nextStep());
    await act2(() => m.app.nextStep());
    expect(m.app.state.step).toBe(3);
  };

  it("submits from the last step, shows the saved request and goes to My events", async () => {
    const m = await mountApp({ role: "organiser" });
    route("POST /event-requests/submit", { id: 21, submitted_at: "2026-10-01T02:00:00Z" });
    await act2(() => m.app.setFormField("name", "Gala"));
    await act2(() => m.app.setFormField("reg", false));
    await toLastStep(m);

    await act2(() => m.app.nextStep());

    expect(m.app.state.events[0]).toMatchObject({ id: "EVT-21", status: "submitted", regClose: null, equipState: null, submittedAt: "2026-10-01T02:00:00Z" });
    expect(m.app.state.events[0].draftForm).toBeUndefined();
    expect(m.app.state).toMatchObject({ step: 1, toast: "Gala submitted for review." });
    expect(router.push).toHaveBeenCalledWith("/my-events");
  });

  it("lists the equipment asked for and the registration close date", async () => {
    const m = await mountApp({ role: "organiser" });
    route("POST /event-requests/submit", { id: 22, submitted_at: null });
    await act2(() => m.app.bumpEquip(EQUIP[0].id, 2));
    await act2(() => m.app.setFormField("regClose", "2026-11-20"));
    await toLastStep(m);

    await act2(() => m.app.nextStep());

    expect(m.app.state.events[0]).toMatchObject({ equipState: "requested", regClose: "2026-11-20" });
    expect(m.app.state.events[0].equip).toEqual([{ id: EQUIP[0].id, qty: 2, technicalRequirements: "" }]);
  });

  it("shows field errors and stays on the last step when the server refuses", async () => {
    const m = await mountApp({ role: "organiser" });
    fail("POST /event-requests/submit", 422, "Date is required", { preferredDate: "Date is required" });
    await toLastStep(m);

    await act2(() => m.app.nextStep());

    expect(m.app.state.formErrors).toEqual({ preferredDate: "Date is required" });
    expect(m.app.state.step).toBe(3);
    expect(router.push).not.toHaveBeenCalled();
  });

  it("shows a refusal without field details like any other error", async () => {
    const m = await mountApp({ role: "organiser" });
    fail("POST /event-requests/submit", 422, "Not accepted");
    await toLastStep(m);

    await act2(() => m.app.nextStep());

    expect(m.app.state).toMatchObject({ toast: "Not accepted", toastKind: "bad" });
  });

  it("ignores a second submit while the first is being saved", async () => {
    const m = await mountApp({ role: "organiser" });
    let release!: () => void;
    route("POST /event-requests/submit", () => new Promise((resolve) => { release = () => resolve({ id: 23, submitted_at: null }); }));
    await toLastStep(m);

    await act2(async () => {
      void m.app.nextStep();
      await flush();
    });
    await act2(() => m.app.nextStep());
    await act2(async () => { release(); await flush(); });

    expect(called("POST /event-requests/submit")).toBe(1);
  });
});

describe("submitDraft (from the list of events)", () => {
  const draft = (overrides: Partial<StoredEvent> = {}) =>
    stored(1, { status: "draft", name: "Saved gala", ...overrides });

  it("does nothing for an event it doesn't have or one that can no longer be edited", async () => {
    const m = await mountApp({ role: "organiser", events: [stored(1, { status: "confirmed" })] });

    await act2(() => m.app.submitDraft("EVT-9"));
    await act2(() => m.app.submitDraft("EVT-1"));

    expect(called("POST /event-requests/submit")).toBe(0);
  });

  it("submits a draft that kept its form, replacing it with the stored copy", async () => {
    const draftForm = { name: "Saved gala", purpose: "", eventType: "", date: "2026-12-01", start: "18:00", end: "21:00", pax: "50",
      venueLocation: "", venueCapacity: "", layout: "banquet", facilities: [], access: [], equip: {}, equipTechnical: {}, reg: false, regCap: "", regClose: "" };
    const m = await mountApp({ role: "organiser", events: [draft({ draftForm: draftForm as never })] });
    route("POST /event-requests/submit", { id: 1, submitted_at: "2026-10-01T02:00:00Z" });

    await act2(() => m.app.submitDraft("EVT-1"));

    const [body] = bodies("POST /event-requests/submit") as Array<Record<string, unknown>>;
    expect(body.draft_id).toBe(1);
    expect(m.app.state.events).toHaveLength(1);
    expect(m.app.state.events[0].status).toBe("submitted");
    expect(m.app.state.toast).toBe("Saved gala submitted for review.");
  });

  it("builds the form from a draft's saved fields when it kept no form", async () => {
    const m = await mountApp({
      role: "organiser",
      events: [draft({ date: "2026-12-01", pax: 40, venueLocation: "Central campus", venueCapacity: 120, regCap: 60, regClose: "2026-11-25", reg: true,
        equip: [{ id: "E1", qty: 2, technicalRequirements: "HDMI" }, { id: "E2", qty: 1 } as never], facilities: ["PA system"], access: ["Step-free access"] })],
    });
    route("POST /event-requests/submit", { id: 1, submitted_at: null });

    await act2(() => m.app.submitDraft("EVT-1"));

    const [body] = bodies("POST /event-requests/submit") as Array<{ event_information: Record<string, unknown> }>;
    expect(body.event_information).toMatchObject({
      name: "Saved gala", date: "2026-12-01", pax: "40", venueLocation: "Central campus", venueCapacity: "120",
      facilities: ["PA system"], access: ["Step-free access"], equip: { E1: 2, E2: 1 }, equipTechnical: { E1: "HDMI", E2: "" }, reg: true, regCap: "60", regClose: "2026-11-25",
    });
  });

  it("builds the form from a draft with nothing filled in yet", async () => {
    const m = await mountApp({
      role: "organiser",
      events: [draft({ date: null, pax: null, venueCapacity: null, regCap: null, regClose: null, reg: false, eventType: "", venueLocation: "" })],
    });
    route("POST /event-requests/submit", { id: 1, submitted_at: null });

    await act2(() => m.app.submitDraft("EVT-1"));

    const [body] = bodies("POST /event-requests/submit") as Array<{ event_information: Record<string, unknown> }>;
    expect(body.event_information).toMatchObject({ date: "", pax: "", venueCapacity: "", regCap: "", regClose: "" });
  });

  it("does not toast when the server refuses the submission", async () => {
    const m = await mountApp({ role: "organiser", events: [draft()] });
    fail("POST /event-requests/submit", 500, "Could not submit");

    await act2(() => m.app.submitDraft("EVT-1"));

    expect(m.app.state.toast).toBe("Could not submit");
  });
});
