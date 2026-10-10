import { describe, expect, it } from "vitest";
import { eventFromApi, eventKey, eventRequestBody, type StoredEvent } from "../../../lib/events/request/api";
import type { NewRequestForm } from "../../../lib/types";

const EQUIPMENT = [
  { id: "E1", name: "Wireless microphone", total: 12 },
  { id: "E2", name: "Projector", total: 6 },
];

/** HTML inputs store numbers as text, so this fixture matches the real form. */
function createForm(): NewRequestForm {
  return {
    name: "Alumni Dinner",
    purpose: "Reconnect alumni and current students.",
    eventType: "networking",
    date: "2030-06-15",
    start: "18:00",
    end: "21:00",
    pax: "120",
    venueLocation: "Main campus",
    venueCapacity: "150",
    layout: "banquet",
    facilities: ["PA system"],
    access: ["Step-free access"],
    equip: { E2: 1, E1: 2 },
    equipTechnical: { E1: "Spare batteries", E2: "HDMI" },
    reg: true,
    regCap: "120",
    regClose: "2030-06-10",
  };
}

describe("US03/US04 - POST /events request body", () => {
  it("sends a complete form as a submission with numbers, dates and times", () => {
    const body = eventRequestBody(createForm(), EQUIPMENT, true);

    expect(body.submit).toBe(true);
    expect(body.expectedAttendance).toBe(120);
    expect(body.preferredDate).toBe("2030-06-15");
    expect(body.startTime).toBe("18:00");
    expect(body.venue).toEqual({
      location: "Main campus",
      capacity: 150,
      layout: "banquet",
      accessibility: ["Step-free access"],
      facilities: ["PA system"],
    });
    expect(body.registration).toEqual({ required: true, capacityLimit: 120, closingDate: "2030-06-10" });
    expect(body.draftForm).toBeNull();
  });

  it("identifies equipment by catalogue id, keeping each item's own details", () => {
    const body = eventRequestBody(createForm(), EQUIPMENT, true);

    expect(body.equipment).toEqual([
      { type: "E1", quantity: 2, technicalRequirements: "Spare batteries" },
      { type: "E2", quantity: 1, technicalRequirements: "HDMI" },
    ]);
  });

  it("sends blank inputs in a draft as null instead of empty text or zero", () => {
    const form = createForm();
    form.pax = "";
    form.venueCapacity = "";
    form.date = "";
    form.start = "";
    form.regCap = "";
    form.regClose = "";

    const body = eventRequestBody(form, EQUIPMENT, false);

    expect(body.expectedAttendance).toBeNull();
    expect(body.venue.capacity).toBeNull();
    expect(body.preferredDate).toBeNull();
    expect(body.startTime).toBeNull();
    expect(body.registration).toEqual({ required: true, capacityLimit: null, closingDate: null });
  });

  it("keeps a copy of the form with a draft so it can be reopened", () => {
    const form = createForm();
    const body = eventRequestBody(form, EQUIPMENT, false);

    expect(body.submit).toBe(false);
    expect(body.draftForm).toEqual(form);
    expect(body.draftForm).not.toBe(form);
  });

  it("names stored events EVT-<id>", () => {
    expect(eventKey(7)).toBe("EVT-7");
  });
});

describe("eventFromApi (stored requests loaded after a reload)", () => {
  const stored: StoredEvent = {
    id: 7,
    status: "submitted",
    name: "Startup Pitch Night",
    organiser: "Maya Rahman",
    coordinator: null,
    purpose: "Eight student ventures pitch to investors.",
    eventType: "networking",
    pax: 95,
    date: "2030-03-21",
    start: "18:30:00",
    end: "21:00:00",
    venueLocation: "Central campus",
    venueCapacity: 120,
    layout: "standing",
    facilities: ["Projector"],
    access: ["Step-free access"],
    equip: [{ id: "E1", qty: 2, technicalRequirements: "HDMI to stage" }],
    reg: true,
    regCap: 120,
    regClose: "2030-03-14",
    venue: null,
    bookingState: null,
    equipState: "requested",
    draftForm: null,
    submittedAt: "2030-03-01T02:00:00Z",
    updatedAt: "2030-03-01T02:00:00Z",
  };

  it("keeps the database id so later saves update the same request", () => {
    const e = eventFromApi(stored);
    expect(e.id).toBe(eventKey(7));
    expect(e.backendId).toBe(7);
  });

  it("shows dates and times the way the event lists do", () => {
    const e = eventFromApi(stored);
    expect(e.date).toBe("21 Mar 2030");
    expect(e.start).toBe("18:30");
    expect(e.end).toBe("21:00");
  });

  it("keeps the request details", () => {
    const e = eventFromApi(stored);
    expect(e).toMatchObject({
      name: "Startup Pitch Night",
      organiser: "Maya Rahman",
      status: "submitted",
      pax: 95,
      layout: "standing",
      venueLocation: "Central campus",
      venueCapacity: 120,
      reg: true,
      regCap: 120,
      regClose: "2030-03-14",
      equip: [{ id: "E1", qty: 2, technicalRequirements: "HDMI to stage" }],
    });
  });

  it("fills sensible defaults for an unfinished draft", () => {
    const e = eventFromApi({
      ...stored,
      status: "draft",
      date: null,
      start: null,
      end: null,
      pax: null,
      layout: null,
      purpose: "",
      regCap: null,
      venueCapacity: null,
      submittedAt: null,
    });
    expect(e.status).toBe("draft");
    expect(e.date).toBe("Date to confirm");
    expect(e.start).toBe("");
    expect(e.pax).toBe(0);
    expect(e.purpose).toBe("No description provided yet.");
    expect(e.submittedAt).toBeUndefined();
  });
});
