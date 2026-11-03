import { describe, expect, it } from "vitest";
import {
  CONFIRMATION_STATUSES,
  confirmedNote,
  lockedFieldsSummary,
  showsConfirmation,
} from "../../../lib/events/confirmation";
import type { EventStatus } from "../../../lib/types";

describe("US14 - Confirm Event (page helpers)", () => {
  it.each<EventStatus>(["approved", "pending_safety_review", "safety_changes_requested", "safety_rejected", "safety_approved", "confirmed"])(
    "[US14-AC2] the confirmation checklist is shown for a %s event",
    (status) => {
      expect(showsConfirmation(status)).toBe(true);
    },
  );

  it.each<EventStatus>(["draft", "submitted", "under_review", "pending_clarification", "rejected", "cancelled"])(
    "[US14-AC2] nothing to confirm yet for a %s event",
    (status) => {
      expect(showsConfirmation(status)).toBe(false);
    },
  );

  it("[US14-AC2] the checklist statuses are exactly the approved-and-after ones", () => {
    expect(CONFIRMATION_STATUSES).toHaveLength(6);
  });

  it("[US14-AC3] says when and by whom the event was confirmed", () => {
    expect(confirmedNote({ confirmedAt: "2027-01-04T01:30:00Z", confirmedBy: "Priya Tan" }, () => "04 Jan 2027, 09:30"))
      .toBe("Confirmed by Priya Tan on 04 Jan 2027, 09:30");
  });

  it("[US14-AC3-B01] still reads without a recorded time or person (confirmed before US14 recorded them)", () => {
    expect(confirmedNote({ confirmedAt: null, confirmedBy: null }, (t) => t)).toBe("Confirmed");
  });

  it("[US14-AC5] names the locked fields as people read them", () => {
    expect(lockedFieldsSummary(["date", "start", "pax", "equipment"]))
      .toBe("date, start time, expected attendance and equipment request");
  });

  it("[US14-AC5-B01] one field, none, and unknown or repeated fields", () => {
    expect(lockedFieldsSummary(["date"])).toBe("date");
    expect(lockedFieldsSummary([])).toBe("");
    expect(lockedFieldsSummary(["somethingNew", "date", "date"])).toBe("somethingNew and date");
  });
});
