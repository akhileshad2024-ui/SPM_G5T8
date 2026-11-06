/** lib/venues/booking.ts: venue booking request helpers (US22, US40, US41). */
import { describe, expect, it } from "vitest";
import {
  attachBookings,
  bookingProblem,
  buildBookingRequest,
  holdingBookings,
  isRebooking,
  mergeBookings,
  releasedSummary,
} from "../../../lib/venues/booking";
import { makeBooking, makeEvent } from "./fixtures";

describe("isRebooking", () => {
  it("is false for an event that never had a booking", () => {
    expect(isRebooking({ bookingState: null, bookings: undefined })).toBe(false);
    expect(isRebooking({ bookingState: null, bookings: [] })).toBe(false);
  });

  it("is true once the event has a booking state or saved bookings", () => {
    expect(isRebooking({ bookingState: "rejected", bookings: [] })).toBe(true);
    expect(isRebooking({ bookingState: null, bookings: [makeBooking()] })).toBe(true);
  });
});

describe("bookingProblem", () => {
  it("allows an approved, saved event with a date and times", () => {
    expect(bookingProblem(makeEvent())).toBeNull();
  });

  it("refuses a first booking for an event that isn't approved yet", () => {
    expect(bookingProblem(makeEvent({ status: "confirmed" }))).toBe("A venue can only be requested for an approved event.");
  });

  it("lets an event that already booked ask again once confirmed", () => {
    expect(bookingProblem(makeEvent({ status: "confirmed", bookingState: "rejected" }))).toBeNull();
    expect(bookingProblem(makeEvent({ status: "pending_safety_review", bookingState: "rejected" }))).not.toBeNull();
  });

  it("lets a replacement through during the safety check", () => {
    expect(bookingProblem(makeEvent({ status: "pending_safety_review" }), true)).toBeNull();
    expect(bookingProblem(makeEvent({ status: "draft" }), true)).not.toBeNull();
  });

  it("asks for the event to be saved first", () => {
    expect(bookingProblem(makeEvent({ backendId: undefined }))).toBe("Save the event before requesting a venue.");
  });

  it("asks for the date and times first", () => {
    expect(bookingProblem(makeEvent({ date: "TBC" }))).toBe("Set the event's date, start time and end time first.");
  });
});

describe("buildBookingRequest", () => {
  it("sends only the event and the acknowledgement when no details are given", () => {
    expect(buildBookingRequest(makeEvent({ backendId: 9 }), false)).toEqual({ event_id: 9, acknowledged: false });
  });

  it("adds each detail that is set, trimming the purpose", () => {
    expect(
      buildBookingRequest(makeEvent({ backendId: 9 }), true, { attendance: 50, layout: "banquet", purpose: "  Breakout  ", replaces: 4 }),
    ).toEqual({ event_id: 9, acknowledged: true, attendance: 50, layout: "banquet", purpose: "Breakout", replaces_booking_id: 4 });
  });

  it("leaves out a blank purpose", () => {
    expect(buildBookingRequest(makeEvent({ backendId: 9 }), true, { purpose: "   " })).toEqual({ event_id: 9, acknowledged: true });
  });
});

describe("mergeBookings", () => {
  it("returns the same event when nothing saved belongs to it", () => {
    const plain = makeEvent();
    const withList = makeEvent({ id: "EV-2", bookings: [makeBooking({ id: 5 })] });
    const out = mergeBookings([plain, withList], [makeBooking({ id: 99 })]);
    expect(out[0]).toBe(plain);
    expect(out[1]).toBe(withList);
  });

  it("swaps in the saved copies in the list and the current booking", () => {
    const old = makeBooking({ id: 5, status: "pending" });
    const event = makeEvent({ bookings: [old, makeBooking({ id: 6 })], bookingRequest: old });
    const saved = makeBooking({ id: 5, status: "approved" });

    const [out] = mergeBookings([event], [saved]);

    expect(out.bookings![0]).toBe(saved);
    expect(out.bookings![1].id).toBe(6);
    expect(out.bookingRequest).toBe(saved);
  });

  it("updates only the current booking when the event keeps no list", () => {
    const saved = makeBooking({ id: 5, status: "approved" });
    const [out] = mergeBookings([makeEvent({ bookingRequest: makeBooking({ id: 5 }) })], [saved]);
    expect(out.bookingRequest).toBe(saved);
    expect(out.bookings).toBeUndefined();
  });

  it("updates only the list when the current booking wasn't saved again", () => {
    const current = makeBooking({ id: 7 });
    const saved = makeBooking({ id: 5, status: "approved" });
    const [out] = mergeBookings([makeEvent({ bookings: [makeBooking({ id: 5 })], bookingRequest: current })], [saved]);
    expect(out.bookings![0]).toBe(saved);
    expect(out.bookingRequest).toBe(current);
  });
});

describe("releasedSummary", () => {
  it("is 'rejected' when every booking was rejected", () => {
    expect(releasedSummary([makeBooking({ status: "rejected" })])).toEqual({ venue: null, bookingState: "rejected" });
  });

  it("has no booking state when some were cancelled, or there are none", () => {
    expect(releasedSummary([makeBooking({ status: "rejected" }), makeBooking({ status: "cancelled" })])).toEqual({ venue: null, bookingState: null });
    expect(releasedSummary([])).toEqual({ venue: null, bookingState: null });
  });
});

describe("holdingBookings", () => {
  it("keeps the pending and approved bookings only", () => {
    const bookings = ["pending", "approved", "rejected", "cancelled", "expired"].map((status, id) =>
      makeBooking({ id, status: status as "pending" }),
    );
    expect(holdingBookings({ bookings }).map((b) => b.status)).toEqual(["pending", "approved"]);
  });

  it("is empty for an event without bookings", () => {
    expect(holdingBookings({ bookings: undefined })).toEqual([]);
  });
});

describe("attachBookings", () => {
  it("leaves an event with no bookings alone", () => {
    const event = makeEvent({ backendId: 1 });
    expect(attachBookings([event], [makeBooking({ event_id: 2 })])[0]).toBe(event);
  });

  it("attaches the bookings, the latest one still held and every override", () => {
    const override = { verdict: "partially_suitable" as const, acknowledged_by: "p", acknowledged_at: "t", unmet: [] };
    const first = makeBooking({ id: 1, status: "approved", override });
    const last = makeBooking({ id: 2, status: "cancelled" });

    const [out] = attachBookings([makeEvent({ backendId: 1 })], [first, last]);

    expect(out.bookings).toEqual([first, last]);
    expect(out.bookingRequest).toBe(first);
    expect(out.venueOverrides).toEqual([override]);
  });

  it("falls back to the newest booking when every one was cancelled", () => {
    const a = makeBooking({ id: 1, status: "cancelled" });
    const b = makeBooking({ id: 2, status: "cancelled" });
    const [out] = attachBookings([makeEvent({ backendId: 1 })], [a, b]);
    expect(out.bookingRequest).toBe(b);
    expect(out.venueOverrides).toEqual([]);
  });
});
