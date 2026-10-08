import { describe, expect, it } from "vitest";
import {
  canReviewEvents,
  needsCoordinatorAction,
  requestDetails,
  reviewChecks,
  reviewQueue,
  startReview,
} from "../../../lib/events/review/review";
import type { EventStatus } from "../../../lib/types";
import { COORDINATOR, ORGANISER, createEvent } from "./fixtures";

const equipName = (id: string) => (id === "E1" ? "Wireless microphone" : id);

/** One event per status, each with a distinct id, name and organiser. */
function eventsByStatus() {
  return [
    createEvent({ id: "EVT-1", name: "Draft Mixer", status: "draft" }),
    createEvent({ id: "EVT-2", name: "Pitch Night", status: "submitted", organiser: "Ana Silva" }),
    createEvent({ id: "EVT-3", name: "Symposium", status: "under_review", coordinator: "Priya Tan" }),
    createEvent({ id: "EVT-4", name: "Workshop", status: "pending_clarification", coordinator: null }),
    createEvent({ id: "EVT-5", name: "Keynote", status: "planning", coordinator: "Marcus Lee" }),
    createEvent({ id: "EVT-6", name: "Career Fair", status: "rejected", coordinator: "Priya Tan" }),
  ];
}

const ids = (list: { id: string }[]) => list.map((e) => e.id);

describe("US07 - Review Submitted Event Requests", () => {
  it("[US07-AC2] shows every submitted request in the queue and never shows drafts", () => {
    // Given: events in every stage, including an unsubmitted draft.
    const events = eventsByStatus();

    // When: the coordinator views the full queue.
    const queue = reviewQueue(events, { filter: "all", search: "", me: COORDINATOR.name });

    // Then: all non-draft events are listed, and the draft is not.
    expect(ids(queue)).toEqual(["EVT-2", "EVT-3", "EVT-4", "EVT-5", "EVT-6"]);
  });

  it("[US07-AC3] 'Needs action' lists new submissions and requests awaiting a decision", () => {
    const queue = reviewQueue(eventsByStatus(), { filter: "action", search: "", me: COORDINATOR.name });

    // Pending clarification waits on the organiser, so it is not listed.
    expect(ids(queue)).toEqual(["EVT-2", "EVT-3"]);
  });

  it("[US07-AC3] 'Unassigned' lists in-review requests with no coordinator", () => {
    const queue = reviewQueue(eventsByStatus(), { filter: "unassigned", search: "", me: COORDINATOR.name });

    expect(ids(queue)).toEqual(["EVT-2", "EVT-4"]);
  });

  it("[US07-AC3] 'Mine' lists only events assigned to the signed-in coordinator", () => {
    const queue = reviewQueue(eventsByStatus(), { filter: "mine", search: "", me: COORDINATOR.name });

    expect(ids(queue)).toEqual(["EVT-3", "EVT-6"]);
  });

  it.each([
    ["event name", "symposium", ["EVT-3"]],
    ["organiser", "ana silva", ["EVT-2"]],
    ["event ID", "evt-5", ["EVT-5"]],
    ["padded, mixed-case text", "  PITCH  ", ["EVT-2"]],
  ])("[US07-AC3] searches by %s", (_label, search, expected) => {
    const queue = reviewQueue(eventsByStatus(), { filter: "all", search, me: COORDINATOR.name });

    expect(ids(queue)).toEqual(expected);
  });

  it("[US07-AC3-B01] returns an empty queue when nothing matches", () => {
    const queue = reviewQueue(eventsByStatus(), { filter: "all", search: "no such event", me: COORDINATOR.name });

    expect(queue).toEqual([]);
  });

  it("[US07-AC4] shows every detail the organiser submitted", () => {
    // Given: a fully completed request.
    const event = createEvent();

    // When: the coordinator opens the request.
    const details = Object.fromEntries(requestDetails(event, equipName));

    // Then: each section of the request is shown with its submitted value.
    expect(details).toEqual({
      "Event type": "dinner",
      "Proposed date": "15 Jun 2030",
      Time: "19:00 – 23:00",
      "Expected attendance": "180",
      "Venue requirements": "Central campus · capacity 200",
      "Required layout": "Banquet",
      Facilities: "Stage, PA system",
      Accessibility: "Step-free access",
      Equipment: "2 × Wireless microphone (Spare batteries)",
      Registration: "Enabled · cap 200 · closes 2030-06-10",
    });
  });

  it("[US07-AC4-B01] labels optional sections that were left empty", () => {
    // Given: a request with no optional details filled in.
    const event = createEvent({
      eventType: undefined,
      venueLocation: undefined,
      venueCapacity: undefined,
      facilities: [],
      access: [],
      equip: [],
      reg: false,
    });

    const details = Object.fromEntries(requestDetails(event, equipName));

    // Then: each empty section says so explicitly instead of disappearing.
    expect(details["Event type"]).toBe("Not specified");
    expect(details["Venue requirements"]).toBe("Not specified");
    expect(details.Facilities).toBe("None specified");
    expect(details.Accessibility).toBe("None specified");
    expect(details.Equipment).toBe("None requested");
    expect(details.Registration).toBe("Not enabled");
  });

  it("[US07-AC4-B02] handles partially filled equipment, layout and registration details", () => {
    // Given: older requests created before technical requirements / closing dates were captured.
    const event = createEvent({
      layout: "" as never,
      equip: [{ id: "E1", qty: 1 }, { id: "E2", qty: 1, technicalRequirements: "   " }],
      regClose: null,
    });

    const details = Object.fromEntries(requestDetails(event, equipName));

    // Then: missing parts are simply omitted rather than shown as blanks.
    expect(details["Required layout"]).toBe("Any");
    expect(details.Equipment).toBe("1 × Wireless microphone, 1 × E2");
    expect(details.Registration).toBe("Enabled · cap 200");
  });

  it("[US07-AC5] raises no concerns for a clear, consistent request", () => {
    expect(reviewChecks(createEvent(), equipName)).toEqual([]);
  });

  it("[US07-AC5] flags attendance above the requested venue capacity", () => {
    const event = createEvent({ pax: 250, venueCapacity: 200, regCap: 250 });

    expect(reviewChecks(event, equipName)).toEqual([
      "Expected attendance (250) is higher than the requested venue capacity (200).",
    ]);
  });

  it("[US07-AC5-B01] does not flag attendance exactly equal to the venue capacity", () => {
    const event = createEvent({ pax: 200, venueCapacity: 200, regCap: 200 });

    expect(reviewChecks(event, equipName)).toEqual([]);
  });

  it("[US07-AC5] flags a registration cap below the expected attendance", () => {
    const event = createEvent({ regCap: 150 });

    expect(reviewChecks(event, equipName)).toEqual([
      "Registration cap (150) is lower than the expected attendance (180).",
    ]);
  });

  it("[US07-AC5-B02] ignores the registration cap when registration is disabled", () => {
    const event = createEvent({ reg: false, regCap: 0 });

    expect(reviewChecks(event, equipName)).toEqual([]);
  });

  it("[US07-AC5] flags each equipment item missing technical requirements", () => {
    const event = createEvent({
      equip: [{ id: "E1", qty: 2 }, { id: "E2", qty: 1, technicalRequirements: "  " }, { id: "E3", qty: 1, technicalRequirements: "HDMI" }],
    });

    expect(reviewChecks(event, equipName)).toEqual([
      "No technical requirements given for Wireless microphone.",
      "No technical requirements given for E2.",
    ]);
  });

  it("[US07-AC5-B03] skips the capacity check when no venue capacity was requested", () => {
    const event = createEvent({ venueCapacity: undefined });

    expect(reviewChecks(event, equipName)).toEqual([]);
  });

  it("[US07-AC6] starting a review moves the request to Under review and tells the organiser", () => {
    // Given: a newly submitted request.
    const event = createEvent();

    // When: a coordinator starts reviewing it.
    const result = startReview(event, COORDINATOR);

    // Then: the status changes, the activity log records it, and the organiser is notified.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.status).toBe("under_review");
    expect(result.event.activity[0]).toMatchObject({ title: "Review started" });
    expect(result.event.activity).toHaveLength(event.activity.length + 1);
    expect(result.notifications).toEqual([
      expect.objectContaining({ to: "organiser", title: "Request under review" }),
    ]);
  });

  it("[US07-AC6-B01] does not mutate the original event", () => {
    const event = createEvent();
    const before = structuredClone(event);

    startReview(event, COORDINATOR);

    expect(event).toEqual(before);
  });

  it.each<EventStatus>(["draft", "under_review", "pending_clarification", "approved", "rejected"])(
    "[US07-AC6] refuses to start a review on a %s request",
    (status) => {
      const result = startReview(createEvent({ status }), COORDINATOR);

      expect(result).toEqual({ ok: false, error: "Only newly submitted requests can be moved into review." });
    },
  );

  it("[US07-AC1] refuses reviews from anyone who is not a coordinator", () => {
    const result = startReview(createEvent(), ORGANISER);

    expect(result).toEqual({ ok: false, error: "Only Event Coordinators can review event requests." });
  });

  it.each([
    ["coordinator", true],
    ["organiser", false],
    ["venue", false],
    ["tech", false],
    ["attendee", false],
  ] as const)("[US07-AC1] %s can review events: %s", (role, expected) => {
    expect(canReviewEvents(role)).toBe(expected);
  });

  it.each<[EventStatus, boolean]>([
    ["submitted", true],
    ["under_review", true],
    ["pending_clarification", false],
    ["approved", false],
    ["draft", false],
  ])("[US07-AC3] a %s request needs coordinator action: %s", (status, expected) => {
    expect(needsCoordinatorAction(createEvent({ status }))).toBe(expected);
  });
});
