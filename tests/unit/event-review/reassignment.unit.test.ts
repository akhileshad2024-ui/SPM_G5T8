import { describe, expect, it } from "vitest";
import { reviewRequest } from "../../../lib/events/review/api";
import {
  historyLine,
  reassignCoordinator,
  reassignTargets,
  type AssignmentHistoryEntry,
} from "../../../lib/events/review/reassignment";
import { MAX_NOTE_LENGTH } from "../../../lib/events/review/shared";
import type { EventStatus } from "../../../lib/types";
import { COORDINATOR, LEAD, NOW, ORGANISER, ROSTER, createEvent, createUnderReview } from "./fixtures";

const REASON = "Priya is on leave for the next two weeks.";

function reassign(event = createUnderReview(), coordinator = "Marcus Lee", reason = REASON, actor = LEAD) {
  return reassignCoordinator(event, actor, { coordinator, coordinators: ROSTER, reason }, NOW);
}

describe("US12 - Reassign Event Coordinator (page rules)", () => {
  it("[US12-AC1] the Lead moves an assigned event to another coordinator", () => {
    const result = reassign();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.coordinator).toBe("Marcus Lee");
    expect(result.event.assignedBy).toBe("Grace Ong");
    expect(result.event.assignedAt).toBe(NOW.toISOString());
    expect(result.event.status).toBe("under_review"); // nothing else about the event changes
  });

  it("[US12-AC1] does not change the original event", () => {
    const event = createUnderReview();
    const before = structuredClone(event);

    reassign(event);

    expect(event).toEqual(before);
  });

  it.each([["the event's coordinator", COORDINATOR], ["an organiser", ORGANISER]])("[US12-AC1] %s cannot reassign", (_who, actor) => {
    expect(reassign(undefined, undefined, undefined, actor)).toEqual({
      ok: false, error: "Only the Event Coordinator Lead can reassign coordinators.",
    });
  });

  it("[US12-AC1] an unassigned event must be assigned, not reassigned", () => {
    expect(reassign(createEvent())).toEqual({ ok: false, error: "This event has no coordinator yet. Assign one instead." });
  });

  it("[US12-AC1] cannot reassign to the coordinator already on it", () => {
    expect(reassign(undefined, "Priya Tan")).toEqual({ ok: false, error: "Priya Tan is already coordinating this event." });
  });

  it.each(["Maya Rahman", ""])("[US12-AC1] only someone on the coordinator roster can take over (%j)", (who) => {
    expect(reassign(undefined, who)).toEqual({ ok: false, error: `${who || "That person"} is not an Event Coordinator.` });
  });

  it.each<EventStatus>(["draft", "rejected", "cancelled"])("[US12-AC1] a %s event cannot be reassigned", (status) => {
    expect(reassign(createUnderReview({ status }))).toEqual({
      ok: false, error: `A coordinator can't be reassigned while the event is ${status}.`,
    });
  });

  it.each(["", "   "])("[US12-AC2] a reason is required (%j)", (reason) => {
    expect(reassign(undefined, undefined, reason)).toEqual({ ok: false, error: "Reassignment reason is required." });
  });

  it("[US12-AC2-B01] a reason of exactly the maximum length is accepted", () => {
    expect(reassign(undefined, undefined, "a".repeat(MAX_NOTE_LENGTH)).ok).toBe(true);
  });

  it("[US12-AC2-B02] a reason one character over the maximum is refused", () => {
    expect(reassign(undefined, undefined, "a".repeat(MAX_NOTE_LENGTH + 1))).toEqual({
      ok: false, error: `Reassignment reason must be ${MAX_NOTE_LENGTH} characters or fewer.`,
    });
  });

  it("[US12-AC2] the reason is logged, trimmed, with who moved it from whom to whom", () => {
    const result = reassign(undefined, undefined, `  ${REASON}  `);

    expect(result.ok && result.event.activity[0]).toMatchObject({
      title: "Coordinator reassigned",
      body: `Grace Ong reassigned the event from Priya Tan to Marcus Lee: ${REASON}`,
    });
  });

  it("[US12-AC4] the page makes no notices of its own: the server notifies everyone affected", () => {
    const result = reassign();

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.notifications).toEqual([]);
  });

  it("[US12] the request sent to the server names the coordinator and the reason", () => {
    expect(reviewRequest(41, { step: "reassign", coordinatorId: 7, reason: REASON })).toEqual({
      path: "/events/41/reassign",
      body: { coordinatorId: 7, reason: REASON },
    });
  });

  it("[US12-AC1] the coordinator already on the event isn't offered as a target", () => {
    expect(reassignTargets({ coordinator: "Priya Tan" }, ROSTER)).toEqual(["Marcus Lee", "Aisha Noor"]);
  });
});

describe("US12 - assignment history (page)", () => {
  const entry = (overrides: Partial<AssignmentHistoryEntry> = {}): AssignmentHistoryEntry => ({
    coordinator: "Marcus Lee", previousCoordinator: "Priya Tan", assignedBy: "Grace Ong",
    assignedAt: "2030-05-10T08:30:00Z", reason: REASON, ...overrides,
  });

  it("[US12-AC5] a first assignment reads as an assignment", () => {
    expect(historyLine(entry({ coordinator: "Priya Tan", previousCoordinator: null, reason: null }))).toBe("Grace Ong assigned Priya Tan");
  });

  it("[US12-AC5] a reassignment reads with who, from whom, to whom and why", () => {
    expect(historyLine(entry())).toBe(`Grace Ong reassigned it from Priya Tan to Marcus Lee: ${REASON}`);
  });

  it("[US12-AC5-B01] still reads when an account has since been removed", () => {
    expect(historyLine(entry({ assignedBy: null, coordinator: null, reason: null }))).toBe(
      "Someone reassigned it from Priya Tan to a coordinator who no longer has an account",
    );
  });
});
