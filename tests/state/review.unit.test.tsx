// @vitest-environment jsdom
/**
 * lib/state/app-context.tsx: the review workflow (assign, reassign, review, clarify, approve,
 * reject), the dialogs they use, the organiser's replies, the safety check, event details and
 * confirming an event. Each action is checked on the page first, then saved through the backend.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
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

const PRIYA = { id: 7, name: "Priya Tan" };
const MARCUS = { id: 8, name: "Marcus Lee" };

/** An event under review that Priya (the coordinator account used below) is assigned to. */
const underReview = (id = 1, overrides: Partial<StoredEvent> = {}) =>
  stored(id, { status: "under_review", coordinator: "Priya Tan", ...overrides });

/** A sample event that was never stored on the server: the backend sent it without an id. */
const unstored = (overrides: Partial<StoredEvent> = {}) => stored(1, { id: undefined as unknown as number, ...overrides });

describe("assignCoordinator (the lead assigns an event)", () => {
  it("saves the assignment, shows the server's event and says who is coordinating", async () => {
    const m = await mountApp({ role: "lead", events: [stored(1)], routes: { "GET /coordinators": [PRIYA] } });
    route("POST /events/1/assign", stored(1, { coordinator: "Priya Tan" }));

    await act2(() => m.app.assignCoordinator("EVT-1", "Priya Tan"));
    await flush();

    expect(bodies("POST /events/1/assign")).toEqual([{ coordinatorId: 7 }]);
    expect(m.app.state.events[0].coordinator).toBe("Priya Tan");
    expect(m.app.state.toast).toBe("Priya Tan is now coordinating Event 1.");
    expect(m.app.state.events[0].activity[0].title).toBe("Coordinator assigned");
    expect(m.app.state.notifs).toEqual([]); // the server saved the notices
  });

  it("does nothing for an event it doesn't have", async () => {
    const m = await mountApp({ role: "lead", routes: { "GET /coordinators": [PRIYA] } });

    await act2(() => m.app.assignCoordinator("EVT-9", "Priya Tan"));

    expect(called("POST /events/9/assign")).toBe(0);
    expect(m.app.state.toast).toBeNull();
  });

  it("refuses, without calling the server, someone who isn't an Event Coordinator", async () => {
    const m = await mountApp({ role: "lead", events: [stored(1)], routes: { "GET /coordinators": [PRIYA] } });

    await act2(() => m.app.assignCoordinator("EVT-1", "Nobody"));

    expect(m.app.state).toMatchObject({ toast: "Nobody is not an Event Coordinator.", toastKind: "warn" });
    expect(called("POST /events/1/assign")).toBe(0);
  });

  it("refuses anyone but the lead", async () => {
    const m = await mountApp({ role: "coordinator", events: [stored(1)] });

    await act2(() => m.app.assignCoordinator("EVT-1", "Priya Tan"));

    expect(m.app.state.toast).toBe("Only the Event Coordinator Lead can assign coordinators.");
  });

  it.each([409, 422])("shows the server's reason when it refuses with %i (for example someone got there first)", async (status) => {
    const m = await mountApp({ role: "lead", events: [stored(1)], routes: { "GET /coordinators": [PRIYA] } });
    fail("POST /events/1/assign", status, "Priya Tan is already coordinating this event.");

    await act2(() => m.app.assignCoordinator("EVT-1", "Priya Tan"));
    await flush();

    expect(m.app.state).toMatchObject({ toast: "Priya Tan is already coordinating this event.", toastKind: "warn" });
  });

  it("handles any other failure like every other call", async () => {
    const m = await mountApp({ role: "lead", events: [stored(1)], routes: { "GET /coordinators": [PRIYA] } });
    fail("POST /events/1/assign", 403, "no");

    await act2(() => m.app.assignCoordinator("EVT-1", "Priya Tan"));
    await flush();

    expect(m.app.state.toast).toBe("You don't have permission to do that.");
  });

  it("changes an event that was never stored on this page only, and notifies on the page", async () => {
    const m = await mountApp({ role: "lead", events: [unstored()], routes: { "GET /coordinators": [PRIYA] } });

    await act2(() => m.app.assignCoordinator("EVT-undefined", "Priya Tan"));
    await flush();

    expect(m.app.state.events[0].coordinator).toBe("Priya Tan");
    expect(m.app.state.notifs.map((n) => n.to)).toEqual(["coordinator", "organiser"]);
  });
});

describe("reassignCoordinator (the lead hands an event to someone else)", () => {
  const setup = () =>
    mountApp({ role: "lead", events: [underReview()], routes: { "GET /coordinators": [PRIYA, MARCUS] } });

  it("saves the reassignment with its reason and says so", async () => {
    const m = await setup();
    route("POST /events/1/reassign", underReview(1, { coordinator: "Marcus Lee" }));

    const ok = await act2(() => m.app.reassignCoordinator("EVT-1", "Marcus Lee", "Priya is on leave"));

    expect(ok).toBe(true);
    expect(bodies("POST /events/1/reassign")).toEqual([{ coordinatorId: 8, reason: "Priya is on leave" }]);
    expect(m.app.state.events[0].coordinator).toBe("Marcus Lee");
    expect(m.app.state.toast).toContain("reassigned to Marcus Lee");
  });

  it("returns false for an event it doesn't have", async () => {
    const m = await setup();

    expect(await act2(() => m.app.reassignCoordinator("EVT-9", "Marcus Lee", "why"))).toBe(false);
  });

  it("refuses a name that isn't on the coordinators' roster", async () => {
    const m = await setup();

    expect(await act2(() => m.app.reassignCoordinator("EVT-1", "Nobody", "why"))).toBe(false);
    expect(m.app.state.toast).toBe("Nobody is not an Event Coordinator.");
  });

  it("returns false and explains when the page's rules refuse (no reason given)", async () => {
    const m = await setup();

    expect(await act2(() => m.app.reassignCoordinator("EVT-1", "Marcus Lee", "  "))).toBe(false);
    expect(m.app.state.toast).toBe("Reassignment reason is required.");
    expect(called("POST /events/1/reassign")).toBe(0);
  });

  it("returns false when the server refuses", async () => {
    const m = await setup();
    fail("POST /events/1/reassign", 409, "Already moved");

    expect(await act2(() => m.app.reassignCoordinator("EVT-1", "Marcus Lee", "Priya is on leave"))).toBe(false);
    expect(m.app.state.toast).toBe("Already moved");
  });
});

describe("with several events on the page, only the one acted on changes", () => {
  it("assign, reply, safety request, details and page-only confirm leave the others alone", async () => {
    const lead = await mountApp({ role: "lead", events: [stored(1), stored(2)], routes: { "GET /coordinators": [PRIYA] } });
    route("POST /events/1/assign", stored(1, { coordinator: "Priya Tan" }));
    await act2(() => lead.app.assignCoordinator("EVT-1", "Priya Tan"));
    await flush();
    expect(lead.app.state.events.map((e) => e.coordinator)).toEqual(["Priya Tan", null]);

    const m = await mountApp({ events: [underReview(1), underReview(2, { name: "Other" })] });
    route("POST /events/1/clarification-response", stored(1, { status: "under_review" }));
    await act2(() => m.app.saveClarificationReply(1, "Reply"));
    route("POST /events/1/safety-check/request", stored(1, { status: "pending_safety_review" }));
    await act2(() => m.app.requestSafetyCheck(1));
    route("PATCH /events/1/details", underReview(1, { name: "Renamed" }));
    await act2(() => m.app.saveEventDetails(1, {} as never));
    expect(m.app.state.events.map((e) => e.name)).toEqual(["Renamed", "Other"]);
    expect(m.app.state.events[1].status).toBe("under_review");

    const sample = await mountApp({ events: [unstored({ status: "approved" }), stored(2)] });
    await act2(() => sample.app.confirmEvent("EVT-undefined"));
    expect(sample.app.state.events.map((e) => e.status)).toEqual(["confirmed", "submitted"]);
  });
});

describe("startReview (a coordinator picks up a submitted request)", () => {
  it("saves the step and shows the event under review", async () => {
    const m = await mountApp({ events: [stored(1)] });
    route("POST /events/1/review", underReview());

    await act2(() => m.app.startReview("EVT-1"));
    await flush();

    expect(m.app.state.events[0].status).toBe("under_review");
    expect(m.app.state.toast).toBe("Reviewing Event 1.");
  });

  it("does nothing for an event it doesn't have", async () => {
    const m = await mountApp();

    await act2(() => m.app.startReview("EVT-5"));

    expect(m.app.state.toast).toBeNull();
  });

  it("refuses a request that isn't newly submitted", async () => {
    const m = await mountApp({ events: [underReview()] });

    await act2(() => m.app.startReview("EVT-1"));

    expect(m.app.state.toast).toBe("Only newly submitted requests can be moved into review.");
    expect(called("POST /events/1/review")).toBe(0);
  });
});

describe("the dialogs", () => {
  it("opens a dialog with its wording and empty text, edits the text and closes it", async () => {
    const m = await mountApp({ events: [underReview()] });

    await act2(() => m.app.openModal("clarify", "EVT-1"));
    expect(m.app.state.modal).toMatchObject({ kind: "clarify", id: "EVT-1", title: "Request clarification" });

    await act2(() => m.app.setModalText("Which investors?"));
    expect(m.app.state.modalText).toBe("Which investors?");

    await act2(() => m.app.closeModal());
    expect(m.app.state).toMatchObject({ modal: null, modalText: "" });
  });

  it("does nothing on confirm when no dialog is open or its event is gone", async () => {
    const m = await mountApp({ events: [underReview()] });

    await act2(() => m.app.confirmModal());
    await act2(() => m.app.openModal("approve", "EVT-9"));
    await act2(() => m.app.confirmModal());

    expect(m.app.state.modal).not.toBeNull();
    expect(m.app.state.toast).toBeNull();
  });

  it.each([
    ["clarify", "clarification", "Which investors?", "Clarification request sent to Maya Rahman."],
    ["amend", "amendment", "Move the start time.", "Amendment request sent to Maya Rahman."],
  ] as const)("sends a %s request, then closes the dialog", async (kind, step, text, toast) => {
    const m = await mountApp({ events: [underReview()] });
    route("POST /events/1/clarification", underReview(1, { status: "pending_clarification" }));
    await act2(() => m.app.openModal(kind, "EVT-1"));
    await act2(() => m.app.setModalText(text));

    await act2(() => m.app.confirmModal());
    await flush();

    expect(bodies("POST /events/1/clarification")).toEqual([{ kind: step, message: text }]);
    expect(m.app.state).toMatchObject({ modal: null, toast });
    expect(m.app.state.events[0].status).toBe("pending_clarification");
  });

  it("keeps the dialog open, with its text, when the request has no message", async () => {
    const m = await mountApp({ events: [underReview()] });
    await act2(() => m.app.openModal("clarify", "EVT-1"));

    await act2(() => m.app.confirmModal());
    await flush();

    expect(m.app.state.modal).not.toBeNull();
    expect(m.app.state.toast).toBe("Clarification message is required.");
  });

  it("approves with a note, closes the dialog and shows the venue tab", async () => {
    const m = await mountApp({ events: [underReview()] });
    route("POST /events/1/decision", stored(1, { status: "approved", coordinator: "Priya Tan" }));
    await act2(() => m.app.openModal("approve", "EVT-1"));
    await act2(() => m.app.setModalText("Looks good"));

    await act2(() => m.app.confirmModal());
    await flush();

    expect(bodies("POST /events/1/decision")).toEqual([{ outcome: "approved", reason: "Looks good" }]);
    expect(m.app.state).toMatchObject({ modal: null, tab: "venue", toast: "Event 1 approved." });
  });

  it("keeps the approve dialog open when the server refuses the decision", async () => {
    const m = await mountApp({ events: [underReview()] });
    fail("POST /events/1/decision", 409, "Someone else decided first");
    await act2(() => m.app.openModal("approve", "EVT-1"));

    await act2(() => m.app.confirmModal());
    await flush();

    expect(m.app.state.modal).not.toBeNull();
    expect(m.app.state.tab).toBe("request");
    expect(m.app.state.toast).toBe("Someone else decided first");
  });

  it("rejects with a reason and shows it as a bad outcome", async () => {
    const m = await mountApp({ events: [underReview()] });
    route("POST /events/1/decision", stored(1, { status: "rejected", coordinator: "Priya Tan" }));
    await act2(() => m.app.openModal("reject", "EVT-1"));
    await act2(() => m.app.setModalText("No venue is free that evening."));

    await act2(() => m.app.confirmModal());
    await flush();

    expect(bodies("POST /events/1/decision")).toEqual([{ outcome: "rejected", reason: "No venue is free that evening." }]);
    expect(m.app.state).toMatchObject({ modal: null, toast: "Event 1 rejected.", toastKind: "bad" });
  });

  it("asks for a note before closing a booking-rejection dialog that has nothing to reject", async () => {
    const m = await mountApp({ events: [underReview()] });
    await act2(() => m.app.openModal("rejectBooking", "EVT-1"));

    await act2(() => m.app.confirmModal());
    expect(m.app.state.toast).toBe("Add a short note before sending.");
    expect(m.app.state.modal).not.toBeNull();

    await act2(() => m.app.setModalText("Held for setup."));
    await act2(() => m.app.confirmModal());
    expect(m.app.state.modal).toBeNull();
  });
});

describe("a change request from the organiser", () => {
  const setup = async () => {
    const m = await mountApp({ role: "organiser", events: [stored(1, { status: "confirmed" })] });
    await act2(() => m.app.openModal("change", "EVT-1"));
    await act2(() => m.app.setModalText("Move the start to 19:30."));
    return m;
  };

  it("saves the proposal and closes the dialog", async () => {
    const m = await setup();
    route("POST /events/1/change-requests", {});

    await act2(() => m.app.confirmModal());
    await flush();

    expect(bodies("POST /events/1/change-requests")).toEqual([{ proposed_changes: "Move the start to 19:30." }]);
    expect(m.app.state).toMatchObject({ modal: null, toast: "Change request submitted." });
    expect(m.app.changeRequestPending).toBe(false);
  });

  it("ignores a second click while the first is being saved, and keeps the dialog open meanwhile", async () => {
    const m = await setup();
    let release!: () => void;
    route("POST /events/1/change-requests", () => new Promise((resolve) => { release = () => resolve({}); }));

    await act2(() => m.app.confirmModal());
    expect(m.app.changeRequestPending).toBe(true);
    await act2(() => m.app.confirmModal());
    await act2(() => m.app.closeModal());
    expect(m.app.state.modal).not.toBeNull();
    expect(called("POST /events/1/change-requests")).toBe(1);

    await act2(async () => { release(); await flush(); });
    expect(m.app.changeRequestPending).toBe(false);
    expect(m.app.state.modal).toBeNull();
  });

  it("shows the error and unlocks when saving fails", async () => {
    const m = await setup();
    fail("POST /events/1/change-requests", 500, "Could not save");

    await act2(() => m.app.confirmModal());
    await flush();

    expect(m.app.state.toast).toBe("Could not save");
    expect(m.app.changeRequestPending).toBe(false);
  });

  it("does nothing for an event that was never stored", async () => {
    const m = await mountApp({ role: "organiser", events: [unstored()] });
    await act2(() => m.app.openModal("change", "EVT-undefined"));

    await act2(() => m.app.confirmModal());

    expect(m.app.changeRequestPending).toBe(false);
    expect(m.app.state.modal).not.toBeNull();
  });
});

describe("the organiser's reply and resuming the review", () => {
  it("saves the reply, replaces the event with the saved one and says so", async () => {
    const m = await mountApp({ role: "organiser", events: [stored(1, { status: "pending_clarification" })] });
    route("POST /events/1/clarification-response", stored(1, { status: "under_review" }));

    const ok = await act2(() => m.app.saveClarificationReply(1, "Three investors."));

    expect(ok).toBe(true);
    expect(bodies("POST /events/1/clarification-response")).toEqual([{ message: "Three investors." }]);
    expect(m.app.state.events[0].status).toBe("under_review");
    expect(m.app.state.toast).toBe("Response saved.");
  });

  it("resumes the review, adding the event to the list when the page didn't have it", async () => {
    const m = await mountApp();
    route("POST /events/4/resume-review", underReview(4));

    const ok = await act2(() => m.app.resumeReview(4));

    expect(ok).toBe(true);
    expect(m.app.state.events.map((e) => e.id)).toEqual(["EVT-4"]);
    expect(m.app.state.toast).toBe("Review resumed.");
  });

  it("returns false and shows the error when saving fails", async () => {
    const m = await mountApp();
    fail("POST /events/4/resume-review", 500, "Not now");

    expect(await act2(() => m.app.resumeReview(4))).toBe(false);
    expect(m.app.state.toast).toBe("Not now");
  });
});

describe("the safety check", () => {
  it("sends an event for a safety check and keeps what the page holds about it", async () => {
    const m = await mountApp({ events: [stored(1, { status: "approved" })] });
    route("POST /events/1/safety-check/request", stored(1, { status: "pending_safety_review" }));

    expect(await act2(() => m.app.requestSafetyCheck(1))).toBe(true);

    expect(m.app.state.events[0].status).toBe("pending_safety_review");
    expect(m.app.state.toast).toBe("Sent for a safety check. The Safety Officers have been told.");
  });

  it("returns false and shows the error when the request is refused", async () => {
    const m = await mountApp({ events: [stored(1, { status: "approved" })] });
    fail("POST /events/1/safety-check/request", 403, "no");

    expect(await act2(() => m.app.requestSafetyCheck(1))).toBe(false);
    expect(m.app.state.toast).toBe("You don't have permission to do that.");
  });

  it.each([
    ["approved", "Safety check approved. The coordinator has been told."],
    ["rejected", "Safety arrangement rejected. The coordinator has been told."],
    ["changes_requested", "Changes requested. The coordinator has been told."],
  ] as const)("records a %s decision, reloads the checks and says so", async (outcome, toast) => {
    const m = await mountApp({ role: "safety" });
    route("POST /events/1/safety-check", {});

    expect(await act2(() => m.app.decideSafetyCheck(1, outcome, "Fire exits are clear"))).toBe(true);

    expect(bodies("POST /events/1/safety-check")).toEqual([{ outcome, comment: "Fire exits are clear", targets: [] }]);
    expect(called("GET /safety-checks")).toBe(2);
    expect(m.app.state.toast).toBe(toast);
  });

  it("sends the parts a change request is about", async () => {
    const m = await mountApp({ role: "safety" });
    route("POST /events/1/safety-check", {});
    const targets = [{ type: "venue" as const, id: 3 }];

    await act2(() => m.app.decideSafetyCheck(1, "changes_requested", "Widen the aisle", targets));

    expect(bodies("POST /events/1/safety-check")).toEqual([{ outcome: "changes_requested", comment: "Widen the aisle", targets }]);
  });

  it("returns false and shows the error when the decision can't be saved", async () => {
    const m = await mountApp({ role: "safety" });
    fail("POST /events/1/safety-check", 409, "Already decided");

    expect(await act2(() => m.app.decideSafetyCheck(1, "approved", ""))).toBe(false);
    expect(m.app.state.toast).toBe("Already decided");
  });
});

describe("saveEventDetails", () => {
  it("saves the edited details over the event and says so", async () => {
    const m = await mountApp({ events: [underReview()] });
    route("PATCH /events/1/details", underReview(1, { name: "Renamed" }));

    expect(await act2(() => m.app.saveEventDetails(1, { name: "Renamed" } as never))).toBe(true);

    expect(bodies("PATCH /events/1/details")).toEqual([{ name: "Renamed" }]);
    expect(m.app.state.events[0].name).toBe("Renamed");
    expect(m.app.state.toast).toBe("Event details saved.");
  });

  it("returns false and shows the error when saving fails", async () => {
    const m = await mountApp({ events: [underReview()] });
    fail("PATCH /events/1/details", 422, "Name is too long");

    expect(await act2(() => m.app.saveEventDetails(1, {} as never))).toBe(false);
    expect(m.app.state.toast).toBe("Name is too long");
  });
});

describe("confirmEvent", () => {
  it("returns false for an event it doesn't have", async () => {
    const m = await mountApp();

    expect(await act2(() => m.app.confirmEvent("EVT-9"))).toBe(false);
  });

  it("confirms an event that was never stored on this page only", async () => {
    const m = await mountApp({ events: [unstored({ status: "approved" })] });

    expect(await act2(() => m.app.confirmEvent("EVT-undefined"))).toBe(true);

    expect(m.app.state.events[0].status).toBe("confirmed");
    expect(m.app.state.toast).toBe("Event 1 confirmed.");
  });

  it("asks the server to confirm, then shows the saved status", async () => {
    const m = await mountApp({ events: [stored(1, { status: "approved" })] });
    route("POST /events/1/confirm", stored(1, { status: "confirmed", updatedAt: "2026-10-09T10:00:00Z" }));

    expect(await act2(() => m.app.confirmEvent("EVT-1"))).toBe(true);

    expect(m.app.state.events[0]).toMatchObject({ status: "confirmed", updatedAt: "2026-10-09T10:00:00Z" });
    expect(m.app.state.toast).toContain("confirmed. The organiser and involved staff have been told.");
  });

  it("lists what is outstanding when the server won't confirm yet", async () => {
    const m = await mountApp({ events: [stored(1, { status: "approved" })] });
    fail("POST /events/1/confirm", 409, "Still outstanding: venue, equipment");

    expect(await act2(() => m.app.confirmEvent("EVT-1"))).toBe(false);
    expect(m.app.state).toMatchObject({ toast: "Still outstanding: venue, equipment", toastKind: "warn" });
  });

  it("handles any other failure like every other call", async () => {
    const m = await mountApp({ events: [stored(1, { status: "approved" })] });
    fail("POST /events/1/confirm", 401, "expired");

    expect(await act2(() => m.app.confirmEvent("EVT-1"))).toBe(false);
    expect(router.push).toHaveBeenCalledWith("/login");
  });
});

