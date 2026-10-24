import type { NotificationRecord, VenueBookingRecord } from "../types";

/**
 * US23-AC5 — the requesting Event Coordinator is told the outcome of each booking request.
 *
 * Venue Staff decide in their own browser, so the coordinator is told when their page next loads,
 * from what the server marks as recently decided (`decision_notice`, kept for 7 days; see
 * backend/venue_bookings.py). Notifications aren't stored on the server yet (US36).
 */

type Notice = Pick<NotificationRecord, "to" | "title" | "body">;

export function decisionNotices(bookings: readonly VenueBookingRecord[]): Notice[] {
  return bookings.flatMap((b): Notice[] => {
    const when = `${b.date}, ${b.start}–${b.end}`;
    if (b.decision_notice === "approved") {
      return [{ to: "coordinator", title: "Venue booking approved", body: `${b.venue_name} is confirmed for ${b.event_name} on ${when}.` }];
    }
    if (b.decision_notice === "rejected") {
      const reason = b.decision_reason ? `: ${b.decision_reason}` : ".";
      return [{
        to: "coordinator",
        title: "Venue booking rejected",
        body: `${b.venue_name} was not approved for ${b.event_name} on ${when}${reason} Request another venue to continue planning.`,
      }];
    }
    return [];
  });
}
