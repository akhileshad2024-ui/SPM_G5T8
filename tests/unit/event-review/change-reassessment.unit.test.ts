import { describe, expect, it } from "vitest";
import {
  EMPTY_CHANGES,
  acceptedChangesPayload,
  describeAcceptedChanges,
  isAcceptedChangeFlag,
  reassessmentSummary,
} from "../../../lib/events/change-reassessment";
import type { BookingReassessment, VenueReassessment } from "../../../lib/types";

const row = (outcome: "still_valid" | "requires_reassessment", id = 1): VenueReassessment["bookings"][number] => ({
  booking_id: id, venue_name: `Hall ${id}`, date: "2027-01-04", start: "10:00", end: "12:00", outcome,
  problems: outcome === "requires_reassessment" ? ["Capacity 150 is below the expected attendance of 200."] : [],
});

const flag = (reason: BookingReassessment["reason"]): BookingReassessment => ({
  reason, message: "m", setup_minutes: null, turnaround_minutes: null, clashes_with: [], problems: [],
  change_request_id: reason === "accepted_change" ? 3 : null, flagged_at: "2027-01-04T01:30:00Z",
});

describe("US49 - Reassess Venue Bookings After an Accepted Change (page helpers)", () => {
  it("[US49-AC1] sends only the fields the coordinator filled in", () => {
    expect(acceptedChangesPayload({ ...EMPTY_CHANGES, date: "2027-01-05", pax: "120", layout: "Classroom" }))
      .toEqual({ changes: { date: "2027-01-05", pax: 120, layout: "classroom" } });
  });

  it("[US49-AC1] a change that names no details sends no changes (the bookings are still re-checked)", () => {
    expect(acceptedChangesPayload(EMPTY_CHANGES)).toEqual({});
    expect(acceptedChangesPayload({ ...EMPTY_CHANGES, start: "  " })).toEqual({});
  });

  it("[US49-AC1] a new time is sent as given", () => {
    expect(acceptedChangesPayload({ ...EMPTY_CHANGES, start: "14:00", end: "16:00" })).toEqual({ changes: { start: "14:00", end: "16:00" } });
  });

  it.each(["0", "-3", "12.5", "lots"])("[US49-AC1-B01] refuses an expected attendance of %s", (pax) => {
    expect(acceptedChangesPayload({ ...EMPTY_CHANGES, pax })).toEqual({ error: "Expected attendance must be a whole number of at least 1." });
  });

  it.each([["14:00", "13:00"], ["14:00", "14:00"]])("[US49-AC1-B02] refuses a new time from %s to %s", (start, end) => {
    expect(acceptedChangesPayload({ ...EMPTY_CHANGES, start, end })).toEqual({ error: "The new end time must be after the start time." });
  });

  it("[US49-AC1] says what the accepted change changes", () => {
    expect(describeAcceptedChanges({ date: "2027-01-05", start: "14:00", pax: 120 }))
      .toBe("Changes: date 2027-01-05, start time 14:00, expected attendance 120.");
    expect(describeAcceptedChanges({})).toBe("No new event details were named.");
    expect(describeAcceptedChanges(null)).toBe("No new event details were named.");
  });

  it("[US49-AC1] [US49-AC2] sums up the re-check", () => {
    const checked_at = "2027-01-04T01:30:00Z";
    expect(reassessmentSummary({ checked_at, bookings: [row("requires_reassessment", 1), row("still_valid", 2)] }))
      .toBe("2 venue bookings re-checked: 1 requires reassessment.");
    expect(reassessmentSummary({ checked_at, bookings: [row("requires_reassessment", 1), row("requires_reassessment", 2)] }))
      .toBe("2 venue bookings re-checked: 2 require reassessment.");
    expect(reassessmentSummary({ checked_at, bookings: [row("still_valid")] })).toBe("1 venue booking re-checked: all still fit.");
    expect(reassessmentSummary({ checked_at, bookings: [] })).toBe("No venue bookings to re-check.");
    expect(reassessmentSummary(null)).toBe("");
  });

  it("[US49-AC2] tells a flag raised by an accepted change from a US38 venue-time flag", () => {
    expect(isAcceptedChangeFlag(flag("accepted_change"))).toBe(true);
    expect(isAcceptedChangeFlag(flag("venue_time_changed"))).toBe(false);
    expect(isAcceptedChangeFlag(null)).toBe(false);
  });
});
