import type { SafetyCheck, SafetyOutcome } from "../types";

/**
 * US44: what the Safety Officer's page shows — pure helpers, no React. The server decides which events the
 * officer receives and what there is to review (backend/safety_check.py, GET /safety-checks), checks every
 * decision again, and records it; these only arrange what it sent and check the comment on the page first.
 */

export const OUTCOME_LABEL: Record<SafetyOutcome, string> = {
  approved: "Approved",
  changes_requested: "Changes requested",
  rejected: "Rejected",
};

/** A comment is mandatory when rejecting or requesting changes (US44 AC4). Returns an error message, or null. */
export function commentError(outcome: SafetyOutcome, comment: string): string | null {
  if (outcome === "approved") return null;
  return comment.trim() ? null : "A comment is required when rejecting or requesting changes.";
}

/** Whether the event is waiting for its safety check. */
export function isAwaiting(check: Pick<SafetyCheck, "status">): boolean {
  return check.status === "pending_safety_review";
}

/** The events waiting for a check, in the order the server sent them (longest waiting first). */
export function awaitingChecks(checks: SafetyCheck[]): SafetyCheck[] {
  return checks.filter(isAwaiting);
}

/** The events already decided (approved, changes requested or rejected), newest first as sent. */
export function decidedChecks(checks: SafetyCheck[]): SafetyCheck[] {
  return checks.filter((c) => !isAwaiting(c));
}

/** How many things the server flagged across everything to review. */
export function concernCount(check: Pick<SafetyCheck, "areas">): number {
  return check.areas.reduce((total, area) => total + area.concerns.length, 0);
}
