import type { AcceptedChanges, BookingReassessment, VenueReassessment } from "../types";

/**
 * US49 — Reassess Venue Bookings After an Accepted Change, on the page. The server re-checks the bookings and
 * flags the ones that no longer fit (backend/change_reassessment.py); these helpers only build what the
 * coordinator sends when accepting, and say what came of it.
 */

/** What the coordinator types when accepting: every field may be left blank (unchanged). */
export interface AcceptedChangesForm {
  date: string;
  start: string;
  end: string;
  pax: string;
  layout: string;
}

export const EMPTY_CHANGES: AcceptedChangesForm = { date: "", start: "", end: "", pax: "", layout: "" };

/**
 * The `changes` to send with an accepted decision, leaving out blank fields, or the reason the form can't be
 * sent. Undefined `changes` means the change names no new details (the bookings are still re-checked).
 */
export function acceptedChangesPayload(form: AcceptedChangesForm): { changes?: AcceptedChanges; error?: string } {
  const changes: AcceptedChanges = {};
  if (form.date.trim()) changes.date = form.date.trim();
  if (form.start.trim()) changes.start = form.start.trim();
  if (form.end.trim()) changes.end = form.end.trim();
  if (form.layout.trim()) changes.layout = form.layout.trim().toLowerCase();
  if (form.pax.trim()) {
    const pax = Number(form.pax);
    if (!Number.isInteger(pax) || pax < 1) return { error: "Expected attendance must be a whole number of at least 1." };
    changes.pax = pax;
  }
  if (changes.start && changes.end && changes.end <= changes.start) return { error: "The new end time must be after the start time." };
  return Object.keys(changes).length ? { changes } : {};
}

const LABELS: Record<keyof AcceptedChanges, string> = {
  date: "date", start: "start time", end: "end time", pax: "expected attendance", layout: "layout",
};

/** "date 2027-01-05, expected attendance 120", or a note that the change named no event details. */
export function describeAcceptedChanges(changes: AcceptedChanges | null | undefined): string {
  const named = (Object.keys(LABELS) as Array<keyof AcceptedChanges>).filter((key) => changes?.[key] !== undefined && changes?.[key] !== null);
  if (!named.length) return "No new event details were named.";
  return `Changes: ${named.map((key) => `${LABELS[key]} ${changes![key]}`).join(", ")}.`;
}

/** "2 venue bookings re-checked: 1 requires reassessment." */
export function reassessmentSummary(result: VenueReassessment | null | undefined): string {
  if (!result) return "";
  const total = result.bookings.length;
  if (!total) return "No venue bookings to re-check.";
  const flagged = result.bookings.filter((b) => b.outcome === "requires_reassessment").length;
  const checked = `${total} venue booking${total === 1 ? "" : "s"} re-checked`;
  return flagged ? `${checked}: ${flagged} require${flagged === 1 ? "s" : ""} reassessment.` : `${checked}: all still fit.`;
}

/** A flag raised by an accepted change (US49), which Venue Staff can clear; a US38 flag clears itself. */
export function isAcceptedChangeFlag(flag: BookingReassessment | null | undefined): boolean {
  return flag?.reason === "accepted_change";
}
