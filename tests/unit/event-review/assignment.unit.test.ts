import { describe, expect, it } from "vitest";
import {
  ASSIGNABLE_STATUSES,
  assignCoordinator,
  canAssignCoordinator,
} from "../../../lib/events/review/assignment";
import { approveRequest } from "../../../lib/events/review/decision";
import type { EventStatus } from "../../../lib/types";
import { COORDINATOR, LEAD, NOW, ORGANISER, ROSTER, createEvent } from "./fixtures";

describe("US11 - Assign Event Coordinator (by the Event Coordinator Lead, US43)", () => {
  it("[US11-AC2] the Lead assigns a coordinator to a submitted event", () => {
    // Given: a submitted event with no coordinator.
    const event = createEvent();

    // When: the Lead assigns Marcus Lee.
    const result = assignCoordinator(event, LEAD, { coordinator: "Marcus Lee", coordinators: ROSTER });

    // Then: Marcus Lee becomes the main point of contact, and who assigned him is logged.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.coordinator).toBe("Marcus Lee");
    expect(result.event.assignedBy).toBe("Grace Ong");
    expect(result.event.activity[0]).toMatchObject({
      title: "Coordinator assigned",
      body: "Grace Ong assigned Marcus Lee as the main internal point of contact.",
    });
  });

  it("[US11-AC2-B01] does not mutate the original event", () => {
    const event = createEvent();
    const before = structuredClone(event);

    assignCoordinator(event, LEAD, { coordinator: "Marcus Lee", coordinators: ROSTER });

    expect(event).toEqual(before);
  });

  it("[US11-AC4] notifies the organiser and the assigned coordinator", () => {
    const result = assignCoordinator(createEvent(), LEAD, { coordinator: "Priya Tan", coordinators: ROSTER });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notifications).toEqual([
      { to: "organiser", title: "Coordinator assigned", body: "Priya Tan is coordinating Alumni Homecoming Dinner." },
      { to: "coordinator", title: "Event assigned to you", body: "Grace Ong assigned Alumni Homecoming Dinner to Priya Tan." },
    ]);
  });

  it.each([ORGANISER, COORDINATOR])("[US43] only the Event Coordinator Lead can assign (not a $role)", (actor) => {
    const result = assignCoordinator(createEvent(), actor, { coordinator: "Priya Tan", coordinators: ROSTER });

    expect(result).toEqual({ ok: false, error: "Only the Event Coordinator Lead can assign coordinators." });
  });

  it("[US11-AC5] rejects someone who is not an Event Coordinator", () => {
    const result = assignCoordinator(createEvent(), LEAD, { coordinator: "Maya Rahman", coordinators: ROSTER });

    expect(result).toEqual({ ok: false, error: "Maya Rahman is not an Event Coordinator." });
  });

  it("[US11-AC5-B01] rejects an empty selection", () => {
    const result = assignCoordinator(createEvent(), LEAD, { coordinator: "", coordinators: ROSTER });

    expect(result).toEqual({ ok: false, error: "That person is not an Event Coordinator." });
  });

  it.each<EventStatus>(["draft", "rejected", "cancelled"])(
    "[US11] cannot assign a coordinator to a %s event",
    (status) => {
      const event = createEvent({ status });

      expect(canAssignCoordinator(event)).toBe(false);
      expect(assignCoordinator(event, LEAD, { coordinator: "Priya Tan", coordinators: ROSTER })).toEqual({
        ok: false,
        error: `A coordinator can't be assigned while the event is ${status}.`,
      });
    },
  );

  it.each(ASSIGNABLE_STATUSES)("[US11] can assign a coordinator to a %s event", (status) => {
    const event = createEvent({ status });

    expect(canAssignCoordinator(event)).toBe(true);
    expect(assignCoordinator(event, LEAD, { coordinator: "Priya Tan", coordinators: ROSTER }).ok).toBe(true);
  });

  it("[US11-AC4] assignment gives the assigned coordinator the event to decide on", () => {
    // Given: a request under review with nobody assigned: no coordinator may decide it.
    const reviewing = createEvent({ status: "under_review" });
    expect(approveRequest(reviewing, COORDINATOR, "", NOW).ok).toBe(false);

    // When: the Lead assigns Priya Tan.
    const assigned = assignCoordinator(reviewing, LEAD, { coordinator: "Priya Tan", coordinators: ROSTER });
    if (!assigned.ok) throw new Error(assigned.error);

    // Then: Priya Tan can approve it.
    expect(approveRequest(assigned.event, COORDINATOR, "", NOW).ok).toBe(true);
  });

  it("[US11] an event that already has a coordinator cannot be assigned again", () => {
    const event = createEvent({ coordinator: "Priya Tan" });

    const result = assignCoordinator(event, LEAD, { coordinator: "Marcus Lee", coordinators: ROSTER });

    expect(result).toEqual({
      ok: false,
      error: "Priya Tan is already coordinating this event.",
    });
  });
});
