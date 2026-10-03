import { describe, expect, it } from "vitest";
import {
  ASSIGNABLE_STATUSES,
  assignCoordinator,
  canAssignCoordinator,
} from "../../../lib/event-review/assignment";
import { approveRequest } from "../../../lib/event-review/decision";
import { startReview } from "../../../lib/event-review/review";
import type { EventStatus } from "../../../lib/types";
import { COORDINATOR, NOW, ORGANISER, ROSTER, createEvent } from "./fixtures";

describe("US11 - Assign Event Coordinator", () => {
  it("[US11-AC1] assigns a coordinator to a submitted event", () => {
    // Given: a submitted event with no coordinator.
    const event = createEvent();

    // When: a coordinator assigns Marcus Lee.
    const result = assignCoordinator(event, COORDINATOR, { coordinator: "Marcus Lee", coordinators: ROSTER });

    // Then: Marcus Lee becomes the main point of contact, and this is logged.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.coordinator).toBe("Marcus Lee");
    expect(result.event.activity[0]).toMatchObject({
      title: "Coordinator assigned",
      body: "Priya Tan assigned Marcus Lee as the main internal point of contact.",
    });
  });

  it("[US11-AC1-B01] does not mutate the original event", () => {
    const event = createEvent();
    const before = structuredClone(event);

    assignCoordinator(event, COORDINATOR, { coordinator: "Marcus Lee", coordinators: ROSTER });

    expect(event).toEqual(before);
  });

  it("[US11-AC2] notifies the organiser and the coordinators", () => {
    const result = assignCoordinator(createEvent(), COORDINATOR, { coordinator: "Priya Tan", coordinators: ROSTER });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.notifications).toEqual([
      { to: "organiser", title: "Coordinator assigned", body: "Priya Tan is coordinating Alumni Homecoming Dinner." },
      { to: "coordinator", title: "Event assigned to you", body: "Priya Tan assigned Alumni Homecoming Dinner to Priya Tan." },
    ]);
  });

  it("[US11-AC3] only Event Coordinators can assign", () => {
    const result = assignCoordinator(createEvent(), ORGANISER, { coordinator: "Priya Tan", coordinators: ROSTER });

    expect(result).toEqual({ ok: false, error: "Only Event Coordinators can assign coordinators." });
  });

  it("[US11-AC3] rejects someone who is not an Event Coordinator", () => {
    const result = assignCoordinator(createEvent(), COORDINATOR, { coordinator: "Maya Rahman", coordinators: ROSTER });

    expect(result).toEqual({ ok: false, error: "Maya Rahman is not an Event Coordinator." });
  });

  it("[US11-AC3-B01] rejects an empty selection", () => {
    const result = assignCoordinator(createEvent(), COORDINATOR, { coordinator: "", coordinators: ROSTER });

    expect(result).toEqual({ ok: false, error: "That person is not an Event Coordinator." });
  });

  it.each<EventStatus>(["draft", "rejected", "cancelled", "completed"])(
    "[US11-AC4] cannot assign a coordinator to a %s event",
    (status) => {
      const event = createEvent({ status });

      expect(canAssignCoordinator(event)).toBe(false);
      expect(assignCoordinator(event, COORDINATOR, { coordinator: "Priya Tan", coordinators: ROSTER })).toEqual({
        ok: false,
        error: `A coordinator can't be assigned while the event is ${status}.`,
      });
    },
  );

  it.each(ASSIGNABLE_STATUSES)("[US11-AC4] can assign a coordinator to a %s event", (status) => {
    const event = createEvent({ status });

    expect(canAssignCoordinator(event)).toBe(true);
    expect(assignCoordinator(event, COORDINATOR, { coordinator: "Priya Tan", coordinators: ROSTER }).ok).toBe(true);
  });

  it("[US11-AC5] assignment unlocks approval for the assigned coordinator", () => {
    // Given: a submitted, unassigned request that has been moved into review.
    const reviewing = startReview(createEvent(), COORDINATOR);
    if (!reviewing.ok) throw new Error(reviewing.error);
    expect(approveRequest(reviewing.event, COORDINATOR, "", NOW).ok).toBe(false);

    // When: Priya Tan takes the event on as coordinator.
    const assigned = assignCoordinator(reviewing.event, COORDINATOR, { coordinator: "Priya Tan", coordinators: ROSTER });
    if (!assigned.ok) throw new Error(assigned.error);

    // Then: Priya Tan can approve it.
    expect(approveRequest(assigned.event, COORDINATOR, "", NOW).ok).toBe(true);
  });

  it("[US11-AC6] an event that already has a coordinator cannot be assigned again", () => {
    const event = createEvent({ coordinator: "Priya Tan" });

    const result = assignCoordinator(event, COORDINATOR, { coordinator: "Marcus Lee", coordinators: ROSTER });

    expect(result).toEqual({
      ok: false,
      error: "Priya Tan is already coordinating this event.",
    });
  });
});
