/**
 * US07 / US08 / US10 / US11 — saving the review steps (lib/events/review/api.ts):
 * which endpoint each step calls, and how the saved event replaces the page's copy.
 */
import { describe, expect, it } from "vitest";
import { coordinatorId, reviewRequest, withSavedReview } from "../../lib/events/review/api";
import type { StoredEvent } from "../../lib/events/request/api";
import { createEvent } from "../unit/event-review/fixtures";

describe("reviewRequest", () => {
  it("[US11] assign sends the chosen coordinator account", () => {
    expect(reviewRequest(7, { step: "assign", coordinatorId: 3 })).toEqual({ path: "/events/7/assign", body: { coordinatorId: 3 } });
  });

  it("[US07] start review has no body", () => {
    expect(reviewRequest(7, { step: "review" })).toEqual({ path: "/events/7/review", body: {} });
  });

  it("[US08] clarification sends the kind and the message", () => {
    expect(reviewRequest(7, { step: "clarification", kind: "amendment", message: "Please move it." })).toEqual({
      path: "/events/7/clarification",
      body: { kind: "amendment", message: "Please move it." },
    });
  });

  it("[US10] a decision sends the outcome and the reason", () => {
    expect(reviewRequest(7, { step: "decision", outcome: "rejected", reason: "Clashes with exams." })).toEqual({
      path: "/events/7/decision",
      body: { outcome: "rejected", reason: "Clashes with exams." },
    });
  });
});

describe("withSavedReview", () => {
  const saved: StoredEvent = {
    id: 7,
    status: "rejected",
    name: "Design Week Keynote",
    organiser: "Maya Rahman",
    coordinator: "Priya Tan",
    updatedAt: "2026-10-10T08:30:00Z",
    clarification: null,
    decision: { outcome: "rejected", by: "Priya Tan", at: "2026-10-10T08:30:00.000Z", reason: "Clashes with exams." },
  };

  it("takes the status, coordinator, decision and last-updated time the server stored", () => {
    const local = createEvent({ id: "EVT-7", backendId: 7, status: "under_review", coordinator: "Priya Tan" });

    const result = withSavedReview(local, saved);

    expect(result.status).toBe("rejected");
    expect(result.coordinator).toBe("Priya Tan");
    expect(result.decision).toEqual(saved.decision);
    expect(result.clarification).toBeUndefined();
    expect(result.updatedAt).toBe("2026-10-10T08:30:00Z");
  });

  it("keeps what only the page holds: the activity log and the rest of the event", () => {
    const local = createEvent({
      id: "EVT-7",
      backendId: 7,
      status: "rejected",
      activity: [{ title: "Request rejected", when: "just now", body: "Priya Tan: Clashes with exams." }],
    });

    const result = withSavedReview(local, saved);

    expect(result.activity).toEqual(local.activity);
    expect(result.name).toBe(local.name);
    expect(result.equip).toEqual(local.equip);
  });

  it("uses the server's value when the page and the server disagree", () => {
    const local = createEvent({ id: "EVT-7", backendId: 7, status: "approved", coordinator: "Someone Else" });

    const result = withSavedReview(local, saved);

    expect(result.status).toBe("rejected");
    expect(result.coordinator).toBe("Priya Tan");
  });
});

describe("coordinatorId", () => {
  const coordinators = [
    { id: 3, name: "Priya Tan" },
    { id: 9, name: "Marcus Lee" },
  ];

  it("[US11] finds the account for the chosen name", () => {
    expect(coordinatorId(coordinators, "Marcus Lee")).toBe(9);
  });

  it("[US11] is undefined for a name that isn't a coordinator account", () => {
    expect(coordinatorId(coordinators, "Aisha Noor")).toBeUndefined();
  });
});
