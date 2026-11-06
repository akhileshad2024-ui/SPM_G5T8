/** lib/venues/conflicts.ts (US38, US46-US48) and lib/venues/replacement.ts (US40). */
import { describe, expect, it } from "vitest";
import { blockingConflicts, needsManualResolution, pendingConflicts, reassessmentList } from "../../../lib/venues/conflicts";
import { flaggedBookings, hasFlaggedBooking, openReplacement, originalOf, replacedBy } from "../../../lib/venues/replacement";
import type { BookingFlag, BookingReassessment } from "../../../lib/types";
import { makeBooking, makeConflict, makeEvent } from "./fixtures";

const flag: BookingFlag = {
  kind: "venue_unavailable", reason: "maintenance", note: null,
  period_start: "2027-01-04T00:00", period_end: "2027-01-05T00:00", message: "Closed", flagged_at: "t",
};
const reassessment: BookingReassessment = {
  reason: "venue_time_changed", message: "Clashes", setup_minutes: 30, turnaround_minutes: 30, clashes_with: [], flagged_at: "t",
};

describe("conflicts", () => {
  const confirmed = makeConflict({ kind: "confirmed_booking", blocks_approval: true });
  const pending = makeConflict({ kind: "pending_request", blocks_approval: false });

  it("picks out the conflicts that block approval and the pending ones", () => {
    const booking = { conflicts: [confirmed, pending] };
    expect(blockingConflicts(booking)).toEqual([confirmed]);
    expect(pendingConflicts(booking)).toEqual([pending]);
  });

  it("finds nothing when there are no conflicts", () => {
    expect(blockingConflicts({ conflicts: [] })).toEqual([]);
    expect(pendingConflicts({ conflicts: [] })).toEqual([]);
  });

  it("needs a manual choice only for a pending request that overlaps another pending one", () => {
    expect(needsManualResolution({ status: "pending", conflicts: [pending] })).toBe(true);
    expect(needsManualResolution({ status: "pending", conflicts: [confirmed] })).toBe(false);
    expect(needsManualResolution({ status: "approved", conflicts: [pending] })).toBe(false);
  });

  it("lists held bookings that need reassessment, soonest first", () => {
    const later = makeBooking({ id: 1, reassessment, hold_start: "2027-02-01T10:00" });
    const sooner = makeBooking({ id: 2, reassessment, status: "approved", hold_start: "2027-01-01T10:00" });
    const released = makeBooking({ id: 3, reassessment, status: "cancelled" });
    const fine = makeBooking({ id: 4 });
    const a = makeEvent({ id: "A", bookings: [later, released, fine] });
    const b = makeEvent({ id: "B", bookings: [sooner] });
    const none = makeEvent({ id: "C", bookings: undefined });

    expect(reassessmentList([a, b, none])).toEqual([{ event: b, booking: sooner }, { event: a, booking: later }]);
  });
});

describe("replacement", () => {
  const flagged = makeBooking({ id: 1, flag, status: "approved" });
  const released = makeBooking({ id: 2, flag, status: "cancelled" });
  const unflagged = makeBooking({ id: 3, flag: undefined as unknown as null });

  it("lists held bookings that are flagged", () => {
    const event = makeEvent({ bookings: [flagged, released, unflagged, makeBooking({ id: 4 })] });
    expect(flaggedBookings([event, makeEvent({ id: "X", bookings: undefined })])).toEqual([{ event, booking: flagged }]);
  });

  it("says whether an event has a flagged booking", () => {
    expect(hasFlaggedBooking({ bookings: [flagged] })).toBe(true);
    expect(hasFlaggedBooking({ bookings: [unflagged] })).toBe(false);
  });

  it("finds the open replacement, ignoring released ones", () => {
    const open = makeBooking({ id: 10, replaces_booking_id: 1, status: "pending" });
    const rejected = makeBooking({ id: 11, replaces_booking_id: 1, status: "rejected" });
    expect(openReplacement({ bookings: [rejected, open] }, flagged)).toBe(open);
    expect(openReplacement({ bookings: [rejected] }, flagged)).toBeUndefined();
    expect(openReplacement({ bookings: undefined }, flagged)).toBeUndefined();
  });

  it("finds the booking a replacement replaces", () => {
    const replacement = makeBooking({ id: 10, replaces_booking_id: 1 });
    expect(originalOf({ bookings: [flagged, replacement] }, replacement)).toBe(flagged);
    expect(originalOf({ bookings: undefined }, replacement)).toBeUndefined();
    expect(originalOf({ bookings: [flagged] }, { replaces_booking_id: null })).toBeUndefined();
    expect(originalOf({ bookings: [flagged] }, {})).toBeUndefined();
  });

  it("finds the approved booking that replaced the original", () => {
    const approved = makeBooking({ id: 10, replaces_booking_id: 1, status: "approved" });
    const pending = makeBooking({ id: 11, replaces_booking_id: 1, status: "pending" });
    expect(replacedBy({ bookings: [pending, approved] }, flagged)).toBe(approved);
    expect(replacedBy({ bookings: [pending] }, flagged)).toBeUndefined();
    expect(replacedBy({ bookings: undefined }, flagged)).toBeUndefined();
  });
});
