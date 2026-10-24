import { describe, expect, it } from "vitest";
import { singaporeTestDate } from "../functional/support/dates";

describe("functional test dates (US09 / US16)", () => {
  it.each([
    ["2026-10-24T15:59:59Z", "2026-10-24", "24 Oct 2026"],
    ["2026-10-24T16:00:00Z", "2026-10-25", "25 Oct 2026"],
    ["2026-11-21T04:00:00Z", "2026-11-21", "21 Nov 2026"],
    ["2026-12-31T16:00:00Z", "2027-01-01", "01 Jan 2027"],
    ["2028-02-28T16:00:00Z", "2028-02-29", "29 Feb 2028"],
  ])("uses the Singapore calendar at %s", (instant, iso, label) => {
    // Fixed instants make this unit test independent of the actual execution day.
    expect(singaporeTestDate(new Date(instant))).toEqual({ iso, label });
  });
});
