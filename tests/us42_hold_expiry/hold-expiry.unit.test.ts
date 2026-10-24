import { describe, expect, it } from "vitest";
import {
  formatCampusTime,
  fromExpiryInput,
  holdExpiryLabel,
  holdNotices,
  toExpiryInput,
} from "../../lib/venues/hold-expiry";
import type { VenueBookingRecord } from "../../lib/types";

/** A booking with only what the hold helpers read. */
function booking(overrides: Partial<VenueBookingRecord> = {}): VenueBookingRecord {
  return {
    id: 1, event_id: 7, event_name: "Design Keynote", venue_id: 3, venue_name: "Lecture Theatre 1",
    date: "2027-01-04", start: "10:00", end: "12:00", setup_minutes: 30, teardown_minutes: 45,
    hold_start: "2027-01-04T09:30:00", hold_end: "2027-01-04T12:45:00", attendance: 100, layout: "theatre",
    purpose: null, status: "pending", verdict: "suitable", requested_by: "priya.tan@connectsphere.edu",
    requested_at: "2027-01-01T01:00:00Z", override: null, decided_by: null, decided_at: null, decision_reason: null,
    flag: null, hold_expires_at: "2027-01-02T10:00:00Z", hold_expiry_set_by: null, hold_notice: null,
    ...overrides,
  };
}

describe("US42 - Expire Tentative Venue Holds (page helpers)", () => {
  describe("campus time for the expiry picker", () => {
    it("[US42-AC1] shows a saved UTC expiry as Singapore time in the picker", () => {
      expect(toExpiryInput("2027-01-02T10:00:00Z")).toBe("2027-01-02T18:00");
    });

    it("[US42-AC1] reads a picked time as Singapore time for the API", () => {
      expect(fromExpiryInput("2027-01-02T18:00")).toBe("2027-01-02T18:00:00+08:00");
    });

    it("[US42-AC1-B01] the picker and the API agree (round trip)", () => {
      const sent = fromExpiryInput(toExpiryInput("2027-03-15T23:30:00Z"))!;
      expect(new Date(sent).toISOString()).toBe("2027-03-15T23:30:00.000Z");
    });

    it("[US42-AC1-B02] crosses midnight correctly", () => {
      expect(toExpiryInput("2027-01-01T20:00:00Z")).toBe("2027-01-02T04:00");
    });

    it.each(["", "2027-01-02", "tomorrow", "2027-01-02T18"])("[US42-AC1-B03] refuses an incomplete time %j", (value) => {
      expect(fromExpiryInput(value)).toBeNull();
    });

    it("[US42-AC1-B04] an empty or unreadable expiry leaves the picker empty", () => {
      expect(toExpiryInput(null)).toBe("");
      expect(toExpiryInput("not a date")).toBe("");
    });

    it("formats a time for people to read, in campus time", () => {
      expect(formatCampusTime("2027-01-02T10:00:00Z")).toBe("02 Jan 2027, 18:00");
    });

    it("shows an unreadable time as it was given", () => {
      expect(formatCampusTime("soon")).toBe("soon");
    });
  });

  describe("what each booking shows", () => {
    it("[US42-AC1] a pending request shows until when it is held", () => {
      expect(holdExpiryLabel(booking())).toBe("Held until 02 Jan 2027, 18:00");
    });

    it("[US42-AC4] an expired hold is shown as expired", () => {
      expect(holdExpiryLabel(booking({ status: "expired" }))).toBe("Hold expired 02 Jan 2027, 18:00");
    });

    it.each<VenueBookingRecord["status"]>(["approved", "rejected", "cancelled"])("[US42-AC4] a %s booking shows no hold", (status) => {
      expect(holdExpiryLabel(booking({ status }))).toBeNull();
    });

    it("a booking saved before holds had an expiry shows nothing", () => {
      expect(holdExpiryLabel(booking({ hold_expires_at: null }))).toBeNull();
    });
  });

  describe("telling the coordinator", () => {
    it("[US42-AC3] warns when a hold is about to expire", () => {
      expect(holdNotices([booking({ hold_notice: "expiring_soon" })])).toEqual([{
        to: "coordinator",
        title: "Venue hold expiring soon",
        body: "Lecture Theatre 1 for Design Keynote is held until 02 Jan 2027, 18:00. It is released if not approved by then.",
      }]);
    });

    it("[US42-AC3] tells them again when it has expired", () => {
      const [notice] = holdNotices([booking({ status: "expired", hold_notice: "expired" })]);
      expect(notice.title).toBe("Venue hold expired");
      expect(notice.body).toContain("has been released");
    });

    it("[US42-AC3] says nothing about holds that aren't close to expiring", () => {
      expect(holdNotices([booking(), booking({ id: 2, status: "approved" })])).toEqual([]);
    });

    it("[US42-AC3-B01] one notice per booking that needs one", () => {
      const notices = holdNotices([
        booking({ id: 1, hold_notice: "expiring_soon" }),
        booking({ id: 2, hold_notice: null }),
        booking({ id: 3, status: "expired", hold_notice: "expired" }),
      ]);
      expect(notices.map((n) => n.title)).toEqual(["Venue hold expiring soon", "Venue hold expired"]);
    });

    it("a notice without an expiry time is ignored", () => {
      expect(holdNotices([booking({ hold_expires_at: null, hold_notice: "expired" })])).toEqual([]);
    });
  });
});
