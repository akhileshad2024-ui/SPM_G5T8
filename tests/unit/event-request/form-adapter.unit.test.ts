import { describe, expect, it } from "vitest";
import { eventRequestFromForm } from "../../../lib/event-request/form-adapter";
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
    equip: { E1: 2 },
    equipTechnical: { E1: "Wireless microphones with spare batteries" },
    reg: true,
    regCap: "120",
    regClose: "2030-06-10",
  };
}

describe("US03/US04 - new-request form adapter unit tests", () => {
  it("[US03-AC1-AC4] converts form strings and selected equipment into domain data", () => {
    // Given: complete values entered through the browser form.
    const form = createForm();

    // When: the UI form is converted for US03 validation.
    const request = eventRequestFromForm(form, EQUIPMENT);

    // Then: numeric fields are numbers and the chosen equipment is preserved.
    expect(request.expectedAttendance).toBe(120);
    expect(request.venue.capacity).toBe(150);
    expect(request.equipment).toEqual([
      {
        type: "Wireless microphone",
        quantity: 2,
        technicalRequirements: "Wireless microphones with spare batteries",
      },
    ]);
    expect(request.registration).toEqual({
      required: true,
      capacityLimit: 120,
      closingDate: "2030-06-10",
    });
  });

  it("[US03-AC3-AC4-B01] omits unselected equipment and disabled registration details", () => {
    // Given: equipment and attendee registration are not required.
    const form = createForm();
    form.equip = {};
    form.reg = false;

    // When: the UI form is converted into domain data.
    const request = eventRequestFromForm(form, EQUIPMENT);

    // Then: optional sections are represented explicitly and remain validatable.
    expect(request.equipment).toEqual([]);
    expect(request.registration).toEqual({
      required: false,
      capacityLimit: null,
      closingDate: null,
    });
  });

  it("[US03-AC3-B02] uses an empty technical requirement when none was entered", () => {
    // Given: selected equipment without technical details.
    const form = createForm();
    form.equipTechnical = {};

    // When: the UI form is converted into domain data.
    const request = eventRequestFromForm(form, EQUIPMENT);

    // Then: validation receives an empty value that it can report to the UI.
    expect(request.equipment[0].technicalRequirements).toBe("");
  });
});
