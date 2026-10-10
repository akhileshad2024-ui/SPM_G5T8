import { describe, expect, it } from "vitest";
import {
  MIN_REJECTION_REASON_LENGTH,
  approveRequest,
  rejectRequest,
} from "../../../lib/events/review/decision";
import { MAX_NOTE_LENGTH } from "../../../lib/events/review/shared";
import {
  COORDINATOR,
  NOW,
  ORGANISER,
  OTHER_COORDINATOR,
  createEvent,
  createUnderReview,
} from "./fixtures";

const REASON = "No venue can accommodate 320 people on that date.";

describe("US10 - Approve or Reject Event Request", () => {
  it("[US10-AC1] [US10-AC4] approving moves the request to Approved and notifies the organiser", () => {
    // Given: a request under review by its assigned coordinator.
    const event = createUnderReview();

    // When: the coordinator approves it without a note.
    const result = approveRequest(event, COORDINATOR, "", NOW);

    // Then: the request is approved and the organiser is told.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.status).toBe("approved");
    expect(result.notifications).toEqual([
      {
        to: "organiser",
        title: "Request approved",
        body: "Alumni Homecoming Dinner has been approved.",
      },
    ]);
  });

  it("[US10-AC1] passes an optional approval note on to the organiser", () => {
    const result = approveRequest(createUnderReview(), COORDINATOR, "  Venue options coming this week.  ", NOW);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.decision?.reason).toBe("Venue options coming this week.");
    expect(result.notifications[0].body).toContain("Venue options coming this week.");
  });

  it("[US10-AC1-B01] rejects an approval note over the maximum length", () => {
    const result = approveRequest(createUnderReview(), COORDINATOR, "a".repeat(MAX_NOTE_LENGTH + 1), NOW);

    expect(result).toEqual({
      ok: false,
      error: `Approval note must be ${MAX_NOTE_LENGTH} characters or fewer.`,
    });
  });

  it("[US10-AC2] rejecting requires a reason", () => {
    const result = rejectRequest(createUnderReview(), COORDINATOR, "   ", NOW);

    expect(result).toEqual({ ok: false, error: "Rejection reason is required." });
  });

  it("[US10-AC2-B01] rejects a reason one character shorter than the minimum", () => {
    const reason = "a".repeat(MIN_REJECTION_REASON_LENGTH - 1);

    const result = rejectRequest(createUnderReview(), COORDINATOR, reason, NOW);

    expect(result).toEqual({
      ok: false,
      error: `Rejection reason must be at least ${MIN_REJECTION_REASON_LENGTH} characters.`,
    });
  });

  it("[US10-AC2-B02] accepts a reason of exactly the minimum length", () => {
    const reason = "a".repeat(MIN_REJECTION_REASON_LENGTH);

    expect(rejectRequest(createUnderReview(), COORDINATOR, reason, NOW).ok).toBe(true);
  });

  it("[US10-AC2-B03] rejects a reason over the maximum length", () => {
    const reason = "a".repeat(MAX_NOTE_LENGTH + 1);

    expect(rejectRequest(createUnderReview(), COORDINATOR, reason, NOW).ok).toBe(false);
  });

  it("[US10-AC2] [US10-AC4] rejecting moves the request to Rejected and sends the reason to the organiser", () => {
    const result = rejectRequest(createUnderReview(), COORDINATOR, REASON, NOW);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.status).toBe("rejected");
    expect(result.notifications).toEqual([
      { to: "organiser", title: "Request rejected", body: `Alumni Homecoming Dinner: ${REASON}` },
    ]);
  });

  it("[US10-AC3] records the outcome, who decided, and when", () => {
    const approved = approveRequest(createUnderReview(), COORDINATOR, "", NOW);
    const rejected = rejectRequest(createUnderReview(), COORDINATOR, REASON, NOW);

    expect(approved.ok && approved.event.decision).toEqual({
      outcome: "approved",
      by: "Priya Tan",
      at: "2030-05-10T08:30:00.000Z",
    });
    expect(rejected.ok && rejected.event.decision).toEqual({
      outcome: "rejected",
      by: "Priya Tan",
      at: "2030-05-10T08:30:00.000Z",
      reason: REASON,
    });
  });

  it("[US10-AC3] adds the decision to the activity log", () => {
    const event = createUnderReview();

    const result = rejectRequest(event, COORDINATOR, REASON, NOW);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.activity[0]).toEqual({
      title: "Request rejected",
      when: "just now",
      body: `Priya Tan: ${REASON}`,
    });
    expect(result.event.activity.slice(1)).toEqual(event.activity);
  });

  it("[US10-AC3-B01] does not mutate the original event", () => {
    const event = createUnderReview();
    const before = structuredClone(event);

    approveRequest(event, COORDINATOR, "", NOW);
    rejectRequest(event, COORDINATOR, REASON, NOW);

    expect(event).toEqual(before);
  });

  it("[US10-AC5] requires a coordinator to be assigned first", () => {
    const result = approveRequest(createUnderReview({ coordinator: null }), COORDINATOR, "", NOW);

    expect(result).toEqual({
      ok: false,
      error: "Assign a coordinator before making a decision on this request.",
    });
  });

  it("[US10-AC5] only the assigned coordinator can decide", () => {
    const result = approveRequest(createUnderReview(), OTHER_COORDINATOR, "", NOW);

    expect(result).toEqual({
      ok: false,
      error: "Only the assigned coordinator (Priya Tan) can make this decision.",
    });
  });

  it("[US10-AC5] non-coordinators cannot decide", () => {
    expect(approveRequest(createUnderReview(), ORGANISER, "", NOW)).toEqual({
      ok: false,
      error: "Only Event Coordinators can review event requests.",
    });
    expect(rejectRequest(createUnderReview(), ORGANISER, REASON, NOW).ok).toBe(false);
  });

  it("[US10-AC5] a request must be under review before a decision", () => {
    const result = approveRequest(createEvent({ coordinator: COORDINATOR.name }), COORDINATOR, "", NOW);

    expect(result).toEqual({
      ok: false,
      error: "Start the review before making a decision on this request.",
    });
  });

  it("[US10-AC6] a decided request cannot be decided again", () => {
    const approved = approveRequest(createUnderReview(), COORDINATOR, "", NOW);
    if (!approved.ok) throw new Error(approved.error);

    expect(rejectRequest(approved.event, COORDINATOR, REASON, NOW)).toEqual({
      ok: false,
      error: "A decision has already been made on this request.",
    });
    expect(approveRequest(approved.event, COORDINATOR, "", NOW).ok).toBe(false);
  });
});
