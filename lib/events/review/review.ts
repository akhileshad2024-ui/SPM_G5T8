import type {
  Actor,
  EventRecord,
  EventStatus,
  QueueFilter,
  Role,
  WorkflowResult,
} from "../../types";
import { fail, isCoordinator, withChanges } from "./shared";

/** Statuses that are still going through coordinator review (US07). */
export const IN_REVIEW_STATUSES: readonly EventStatus[] = [
  "submitted",
  "under_review",
  "pending_clarification",
];

/** Only Event Coordinators may open the review queue. */
export function canReviewEvents(role: Role): boolean {
  return role === "coordinator";
}

/**
 * True when the coordinator has to do something next: a new submission to
 * pick up, or a request under review that is waiting on their decision.
 * Pending clarification waits on the organiser, so it is not counted.
 */
export function needsCoordinatorAction(event: EventRecord): boolean {
  return event.status === "submitted" || event.status === "under_review";
}

/**
 * Builds the coordinator's review queue (US07).
 *
 * Drafts are never shown: they have not been submitted and still belong to
 * the organiser. Search matches the event name, organiser, or event ID.
 */
export function reviewQueue(
  events: EventRecord[],
  { filter, search, me }: { filter: QueueFilter; search: string; me: string },
): EventRecord[] {
  const q = search.trim().toLowerCase();

  return events.filter((e) => {
    if (e.status === "draft") return false;
    if (filter === "action" && !needsCoordinatorAction(e)) return false;
    if (filter === "unassigned" && !(IN_REVIEW_STATUSES.includes(e.status) && !e.coordinator)) return false;
    if (filter === "mine" && e.coordinator !== me) return false;
    if (q && !`${e.name} ${e.organiser} ${e.id}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

/**
 * Lists every detail the organiser submitted, in the order the coordinator
 * reads them. Empty optional fields are shown explicitly rather than hidden,
 * so a coordinator can tell "not provided" apart from "missing from the view".
 */
export function requestDetails(
  event: EventRecord,
  equipName: (id: string) => string,
): Array<[string, string]> {
  const layout = event.layout
    ? event.layout.charAt(0).toUpperCase() + event.layout.slice(1)
    : "Any";

  const venueNeeds = [
    event.venueLocation,
    event.venueCapacity ? `capacity ${event.venueCapacity}` : "",
  ].filter(Boolean).join(" · ");

  const equipment = event.equip
    .map((it) => {
      const tech = it.technicalRequirements?.trim();
      return `${it.qty} × ${equipName(it.id)}${tech ? ` (${tech})` : ""}`;
    })
    .join(", ");

  let registration = "Not enabled";
  if (event.reg) {
    registration = `Enabled · cap ${event.regCap}`;
    if (event.regClose) registration += ` · closes ${event.regClose}`;
  }

  return [
    ["Event type", event.eventType || "Not specified"],
    ["Proposed date", event.date],
    ["Time", `${event.start} – ${event.end}`],
    ["Expected attendance", event.pax > 0 ? String(event.pax) : "Not specified"],
    ["Venue requirements", venueNeeds || "Not specified"],
    ["Required layout", layout],
    ["Facilities", event.facilities.join(", ") || "None specified"],
    ["Accessibility", event.access.join(", ") || "None specified"],
    ["Equipment", equipment || "None requested"],
    ["Registration", registration],
  ];
}

/**
 * US07: points out requirements that look unclear or inconsistent, so the
 * coordinator can decide whether to approve or ask for clarification (US08).
 * These are prompts for judgement, not blockers — US03 validation has already
 * rejected anything outright invalid.
 */
export function reviewChecks(
  event: EventRecord,
  equipName: (id: string) => string,
): string[] {
  const issues: string[] = [];

  if (event.venueCapacity && event.pax > event.venueCapacity) {
    issues.push(
      `Expected attendance (${event.pax}) is higher than the requested venue capacity (${event.venueCapacity}).`,
    );
  }
  if (event.reg && event.regCap < event.pax) {
    issues.push(
      `Registration cap (${event.regCap}) is lower than the expected attendance (${event.pax}).`,
    );
  }
  event.equip
    .filter((it) => !it.technicalRequirements?.trim())
    .forEach((it) => issues.push(`No technical requirements given for ${equipName(it.id)}.`));

  return issues;
}

/**
 * A coordinator picks up a newly submitted request: Submitted → Under review.
 * The organiser is told their request is now being reviewed.
 */
export function startReview(event: EventRecord, actor: Actor): WorkflowResult {
  if (!isCoordinator(actor)) {
    return fail("Only Event Coordinators can review event requests.");
  }
  if (event.status !== "submitted") {
    return fail("Only newly submitted requests can be moved into review.");
  }

  return {
    ok: true,
    event: withChanges(
      event,
      { status: "under_review", submittedAgo: "under review" },
      { title: "Review started", body: `${actor.name} started reviewing the request.` },
    ),
    notifications: [
      {
        to: "organiser",
        title: "Request under review",
        body: `${event.name} is now being reviewed by ${actor.name}.`,
      },
    ],
  };
}
