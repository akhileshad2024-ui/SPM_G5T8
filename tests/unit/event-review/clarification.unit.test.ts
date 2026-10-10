import { describe, expect, it } from "vitest";
import { requestClarification } from "../../../lib/events/review/clarification";
import { approveRequest, rejectRequest } from "../../../lib/events/review/decision";
import { MAX_NOTE_LENGTH } from "../../../lib/events/review/shared";
import type { EventStatus } from "../../../lib/types";
import {
  COORDINATOR,
  NOW,
  ORGANISER,
  OTHER_COORDINATOR,
  QUESTION,
  createEvent,
  createPendingClarification,
  createUnderReview,
} from "./fixtures";

describe("US08 - Request Clarification or Amendments", () => {
  it("[US08-AC1] puts a request under review on hold as Pending clarification", () => {
    // Given: a request the coordinator is assigned to and reviewing.
    const event = createUnderReview();

    // When: the coordinator asks the organiser a question.
    const result = requestClarification(event, COORDINATOR, { kind: "clarification", message: QUESTION }, NOW);

    // Then: the request waits for the organiser.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.status).toBe("pending_clarification");
  });

  it("[US08-AC1] supports amendment requests as well as clarifications", () => {
    const result = requestClarification(
      createUnderReview(),
      COORDINATOR,
      { kind: "amendment", message: "Please move the start time to 18:00." },
      NOW,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.status).toBe("pending_clarification");
    expect(result.event.clarification?.kind).toBe("amendment");
    expect(result.event.activity[0].title).toBe("Amendment requested");
    expect(result.notifications[0].title).toBe("Amendment requested");
  });

  it("[US08-AC2] requires a message", () => {
    const result = requestClarification(createUnderReview(), COORDINATOR, { kind: "clarification", message: "   " }, NOW);

    expect(result).toEqual({ ok: false, error: "Clarification message is required." });
  });

  it("[US08-AC2-B01] accepts a message of exactly the maximum length", () => {
    const message = "a".repeat(MAX_NOTE_LENGTH);

    const result = requestClarification(createUnderReview(), COORDINATOR, { kind: "clarification", message }, NOW);

    expect(result.ok).toBe(true);
  });

  it("[US08-AC2-B02] rejects a message one character over the maximum length", () => {
    const message = "a".repeat(MAX_NOTE_LENGTH + 1);

    const result = requestClarification(createUnderReview(), COORDINATOR, { kind: "clarification", message }, NOW);

    expect(result).toEqual({
      ok: false,
      error: `Clarification message must be ${MAX_NOTE_LENGTH} characters or fewer.`,
    });
  });

  it("[US08-AC3] records who asked what and when, and notifies the organiser", () => {
    const result = requestClarification(
      createUnderReview(),
      COORDINATOR,
      { kind: "clarification", message: `  ${QUESTION}  ` },
      NOW,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.event.clarification).toEqual({
      kind: "clarification",
      message: QUESTION,
      requestedBy: "Priya Tan",
      requestedAt: "2030-05-10T08:30:00.000Z",
    });
    expect(result.event.activity[0]).toMatchObject({
      title: "Clarification requested",
      body: `Priya Tan: ${QUESTION}`,
    });
    expect(result.notifications).toEqual([
      { to: "organiser", title: "Clarification requested", body: `Alumni Homecoming Dinner: ${QUESTION}` },
    ]);
  });

  it("[US08-AC3-B01] does not mutate the original event", () => {
    const event = createUnderReview();
    const before = structuredClone(event);

    requestClarification(event, COORDINATOR, { kind: "clarification", message: QUESTION }, NOW);

    expect(event).toEqual(before);
  });

  it("[US08-AC4] blocks approval while waiting for the organiser", () => {
    const result = approveRequest(createPendingClarification(), COORDINATOR, "", NOW);

    expect(result).toEqual({
      ok: false,
      error: "Waiting for the organiser to respond to your clarification request.",
    });
  });

  it("[US08-AC4] blocks rejection while waiting for the organiser", () => {
    const result = rejectRequest(createPendingClarification(), COORDINATOR, "No suitable venue available.", NOW);

    expect(result.ok).toBe(false);
  });

  it("[US08-AC5] only the assigned coordinator can ask for clarification", () => {
    const result = requestClarification(
      createUnderReview(),
      OTHER_COORDINATOR,
      { kind: "clarification", message: QUESTION },
      NOW,
    );

    expect(result).toEqual({
      ok: false,
      error: "Only the assigned coordinator (Priya Tan) can make this decision.",
    });
  });

  it("[US08-AC5] organisers cannot send clarification requests", () => {
    const result = requestClarification(createUnderReview(), ORGANISER, { kind: "clarification", message: QUESTION }, NOW);

    expect(result).toEqual({ ok: false, error: "Only Event Coordinators can review event requests." });
  });

  it.each<[EventStatus, string]>([
    ["submitted", "Start the review before making a decision on this request."],
    ["pending_clarification", "Waiting for the organiser to respond to your clarification request."],
    ["approved", "A decision has already been made on this request."],
    ["rejected", "A decision has already been made on this request."],
  ])("[US08-AC5] cannot ask for clarification on a %s request", (status, error) => {
    const result = requestClarification(
      createEvent({ status, coordinator: COORDINATOR.name }),
      COORDINATOR,
      { kind: "clarification", message: QUESTION },
      NOW,
    );

    expect(result).toEqual({ ok: false, error });
  });
});
