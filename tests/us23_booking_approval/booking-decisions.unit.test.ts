import { describe, expect, it } from "vitest";
import { decisionNotices } from "../../lib/venues/booking-decisions";
import type { VenueBookingRecord } from "../../lib/types";

function booking(overrides: Partial<VenueBookingRecord> = {}): VenueBookingRecord {
  return {
    id: 1, event_id: 7, event_name: "Design Keynote", venue_id: 3, venue_name: "Grand Hall",
    date: "2027-01-04", start: "10:00", end: "12:00", setup_minutes: 30, teardown_minutes: 45,
    hold_start: "2027-01-04T09:30:00", hold_end: "2027-01-04T12:45:00", attendance: 100, layout: "theatre",
    purpose: null, status: "approved", verdict: "suitable", requested_by: "priya.tan@connectsphere.edu",
    requested_at: "2027-01-01T01:00:00Z", override: null, decided_by: "daniel.ortiz@connectsphere.edu",
    decided_at: "2027-01-02T01:00:00Z", decision_reason: null, flag: null, reassessment: null, conflicts: [],
    decision_notice: "approved",
    ...overrides,
  };
}

describe("US23 - Approve or Reject Venue Booking (telling the coordinator)", () => {
  it("[US23-AC5] tells the coordinator a booking was approved", () => {
    expect(decisionNotices([booking()])).toEqual([{
      to: "coordinator",
      title: "Venue booking approved",
      body: "Grand Hall is confirmed for Design Keynote on 2027-01-04, 10:00–12:00.",
    }]);
  });

  it("[US23-AC5] tells the coordinator a booking was rejected, with the reason", () => {
    const [notice] = decisionNotices([booking({ status: "rejected", decision_notice: "rejected", decision_reason: "Held for maintenance." })]);

    expect(notice.title).toBe("Venue booking rejected");
    expect(notice.body).toBe(
      "Grand Hall was not approved for Design Keynote on 2027-01-04, 10:00–12:00: Held for maintenance. Request another venue to continue planning.",
    );
  });

  it("[US23-AC5-B01] a rejection saved without a reason still reads correctly", () => {
    const [notice] = decisionNotices([booking({ status: "rejected", decision_notice: "rejected", decision_reason: null })]);

    expect(notice.body).toContain("10:00–12:00. Request another venue");
  });

  it("[US23-AC5] says nothing about requests still pending or decided long ago", () => {
    expect(decisionNotices([booking({ status: "pending", decision_notice: null }), booking({ decision_notice: null })])).toEqual([]);
  });

  it("[US23-AC6] one notice per booking, even for the same event", () => {
    const notices = decisionNotices([
      booking({ id: 1, venue_name: "Auditorium" }),
      booking({ id: 2, venue_name: "Seminar Room", status: "rejected", decision_notice: "rejected", decision_reason: "Too small." }),
    ]);

    expect(notices.map((n) => n.title)).toEqual(["Venue booking approved", "Venue booking rejected"]);
  });
});
