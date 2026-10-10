/**
 * US15 — View Event Information: unit tests for lib/events/details.ts, which turns an event
 * as the server sent it for the signed-in role into the rows of the details view, and for
 * eventFromApi() coping with the fields a role was not sent.
 */
import { describe, expect, it } from "vitest";
import {
  attendanceLabel,
  detailSections,
  formatDate,
  formatTimes,
  lastUpdatedLabel,
  type DetailSection,
} from "../../lib/events/details";
import { eventFromApi, type StoredEvent } from "../../lib/events/request/api";
import { requestDetails } from "../../lib/events/review/review";

/** The organiser's view of a fully arranged event: every field present. */
function fullEvent(overrides: Partial<StoredEvent> = {}): StoredEvent {
  return {
    id: 7,
    status: "confirmed",
    name: "Startup Pitch Night",
    purpose: "Eight student ventures pitch to investors.",
    eventType: "networking",
    date: "2026-11-26",
    start: "18:30:00",
    end: "21:00:00",
    organiser: "Maya Rahman",
    coordinator: "Priya Tan",
    pax: 95,
    venueLocation: "Central campus",
    venueCapacity: 120,
    layout: "standing",
    facilities: ["Projector", "PA system"],
    access: ["Step-free access"],
    venue: 3,
    venueName: "Grand Hall",
    bookingState: "approved",
    equip: [{ id: "E1", qty: 2, technicalRequirements: "HDMI to stage" }],
    equipState: "reserved",
    reg: true,
    regCap: 120,
    regClose: "2026-11-20",
    clarification: { kind: "clarification", message: "Which investors?" },
    decision: { outcome: "approved", reason: "Well planned" },
    submittedAt: "2026-10-01T02:00:00Z",
    createdAt: "2026-09-29T02:00:00Z",
    updatedAt: "2026-10-08T09:23:00Z",
    ...overrides,
  } as StoredEvent;
}

/** What an attendee is sent for the same event: the backend left the other fields out. */
function attendeeView(): StoredEvent {
  const e = fullEvent();
  return {
    id: e.id, status: e.status, name: e.name, purpose: e.purpose, eventType: e.eventType,
    date: e.date, start: e.start, end: e.end, organiser: e.organiser, updatedAt: e.updatedAt,
    access: e.access, venueName: e.venueName, reg: e.reg, regCap: e.regCap, regClose: e.regClose,
  } as StoredEvent;
}

function rows(sections: DetailSection[]): Record<string, string> {
  return Object.fromEntries(sections.flatMap((s) => s.rows.map((r) => [r.label, r.value])));
}

const titles = (sections: DetailSection[]) => sections.map((s) => s.title);

describe("detailSections (AC1: the information permitted for the role)", () => {
  it("shows the organiser every saved detail, grouped into sections", () => {
    const sections = detailSections(fullEvent(), (id) => (id === "E1" ? "Wireless mic" : id), "Asia/Singapore");

    expect(titles(sections)).toEqual(["Event", "People", "Venue", "Equipment", "Registration", "Review"]);
    expect(rows(sections)).toEqual({
      Status: "Confirmed",
      "Event type": "Networking",
      Description: "Eight student ventures pitch to investors.",
      Date: "26 Nov 2026",
      Time: "18:30 – 21:00",
      "Expected attendance": "95",
      Organiser: "Maya Rahman",
      Coordinator: "Priya Tan",
      Venue: "Grand Hall",
      Booking: "Approved",
      "Preferred location": "Central campus",
      "Required capacity": "120",
      Layout: "Standing",
      Facilities: "Projector, PA system",
      Accessibility: "Step-free access",
      Requested: "2 × Wireless mic (HDMI to stage)",
      "Equipment status": "Reserved",
      "Attendee registration": "Open",
      "Capacity limit": "120",
      Closes: "20 Nov 2026",
      Submitted: "01 Oct 2026, 10:00",
      "Clarification requested": "Which investors?",
      Decision: "Approved: Well planned",
    });
  });

  it("shows an attendee only the details they were sent", () => {
    const sections = detailSections(attendeeView());

    expect(titles(sections)).toEqual(["Event", "People", "Venue", "Registration"]);
    expect(Object.keys(rows(sections))).toEqual([
      "Status", "Event type", "Description", "Date", "Time",
      "Organiser",
      "Venue", "Accessibility",
      "Attendee registration", "Capacity limit", "Closes",
    ]);
  });
});

describe("detailSections (AC2: hidden fields are not shown as empty)", () => {
  it("gives no row at all for a field the role was not sent", () => {
    const shown = rows(detailSections(attendeeView()));

    for (const hidden of ["Expected attendance", "Coordinator", "Booking", "Layout", "Requested",
      "Equipment status", "Submitted", "Decision", "Clarification requested"]) {
      expect(shown).not.toHaveProperty(hidden);
    }
  });

  it("leaves out a whole section when every field in it is hidden", () => {
    const { equip, equipState, ...rest } = fullEvent();
    void equip;
    void equipState;

    expect(titles(detailSections(rest as StoredEvent))).not.toContain("Equipment");
  });

  it("shows a permitted field with no value yet as not set, rather than hiding it", () => {
    const shown = rows(
      detailSections(
        fullEvent({
          status: "submitted", eventType: "", purpose: "", date: null, start: null, end: null, pax: null,
          coordinator: null, venueName: null, bookingState: null, venueLocation: "", venueCapacity: null,
          layout: null, facilities: [], access: [], equip: [], equipState: null, reg: false,
          submittedAt: null, clarification: null, decision: null,
        }),
      ),
    );

    expect(shown).toMatchObject({
      "Event type": "Not set",
      Description: "Not set",
      Date: "Not set",
      Time: "Not set",
      "Expected attendance": "Not set",
      Coordinator: "Not yet assigned",
      Venue: "Not booked yet",
      Booking: "Not requested",
      "Preferred location": "Not set",
      "Required capacity": "Not set",
      Layout: "Not set",
      Facilities: "None",
      Accessibility: "None",
      Requested: "None",
      "Equipment status": "None requested",
      "Attendee registration": "Not required",
      Submitted: "Not submitted yet",
    });
  });

  it("only shows the capacity limit and closing date while registration is open", () => {
    const shown = rows(detailSections(fullEvent({ reg: false })));

    expect(shown["Attendee registration"]).toBe("Not required");
    expect(shown).not.toHaveProperty("Capacity limit");
    expect(shown).not.toHaveProperty("Closes");
  });

  it("shows no clarification or decision row until there is one", () => {
    const shown = rows(detailSections(fullEvent({ clarification: null, decision: null })));

    expect(shown).not.toHaveProperty("Clarification requested");
    expect(shown).not.toHaveProperty("Decision");
  });

  it("shows a decision without a reason as just its outcome", () => {
    expect(rows(detailSections(fullEvent({ decision: { outcome: "rejected" } }))).Decision).toBe("Rejected");
  });

  it("lists every requested equipment item by name", () => {
    const e = fullEvent({
      equip: [
        { id: "E1", qty: 2, technicalRequirements: "" },
        { id: "E9", qty: 1, technicalRequirements: "Spare batteries" },
      ],
    });

    expect(rows(detailSections(e, (id) => ({ E1: "Wireless mic" })[id] ?? id)).Requested).toBe(
      "2 × Wireless mic; 1 × E9 (Spare batteries)",
    );
  });
});

describe("attendanceLabel (AC2: an attendance not given yet is not shown as 0)", () => {
  it("shows the expected attendance with its unit", () => {
    expect(attendanceLabel(95, "expected")).toBe("95 expected");
    expect(attendanceLabel(95, "pax")).toBe("95 pax");
  });

  it("says the attendance is not set when there isn't one", () => {
    for (const pax of [0, null, undefined]) {
      expect(attendanceLabel(pax, "expected")).toBe("attendance not set");
    }
  });

  it("lists a request without an attendance as not specified in the coordinator's request details", () => {
    const e = eventFromApi(fullEvent({ pax: null }));

    expect(e.pax).toBe(0);
    expect(Object.fromEntries(requestDetails(e, (id) => id))["Expected attendance"]).toBe("Not specified");
  });
});

describe("lastUpdatedLabel (AC3: the last-updated timestamp)", () => {
  it("says when the event was last saved, in the viewer's time zone", () => {
    const e = { updatedAt: "2026-10-08T09:23:00Z" };

    expect(lastUpdatedLabel(e, "Asia/Singapore")).toBe("Last updated 08 Oct 2026, 17:23");
    expect(lastUpdatedLabel(e, "UTC")).toBe("Last updated 08 Oct 2026, 09:23");
  });
});

describe("formatDate / formatTimes", () => {
  it("writes a date out in words", () => {
    expect(formatDate("2026-11-26")).toBe("26 Nov 2026");
  });

  it("says a missing date is not set", () => {
    expect(formatDate(null)).toBe("Not set");
    expect(formatDate(undefined)).toBe("Not set");
  });

  it("shows the start and end time without seconds", () => {
    expect(formatTimes("09:00:00", "17:30:00")).toBe("09:00 – 17:30");
  });

  it("marks a missing start or end time", () => {
    expect(formatTimes("09:00:00", null)).toBe("09:00 – ?");
    expect(formatTimes(null, "17:30:00")).toBe("? – 17:30");
    expect(formatTimes(null, null)).toBe("Not set");
  });
});

describe("eventFromApi with a role's limited view", () => {
  it("fills in safe defaults for the fields the role was not sent, so lists still work", () => {
    const e = eventFromApi(attendeeView());

    expect(e.coordinator).toBeNull();
    expect(e.venue).toBeNull();
    expect(e.venueName).toBe("Grand Hall");
    expect(e.bookingState).toBeNull();
    expect(e.equip).toEqual([]);
    expect(e.equipState).toBeNull();
    expect(e.facilities).toEqual([]);
    expect(e.reg).toBe(true);
    expect(e.updatedAt).toBe("2026-10-08T09:23:00Z");
  });

  it("keeps the booked venue's id for roles that may see the booking", () => {
    expect(eventFromApi(fullEvent()).venue).toBe("3");
  });
});
