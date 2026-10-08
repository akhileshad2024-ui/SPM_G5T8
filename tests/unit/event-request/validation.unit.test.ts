import { describe, expect, it } from "vitest";
import { validateEventRequest } from "../../../lib/events/request/validation";
import type { EventRequestDraft } from "../../../lib/types";

const TODAY = "2030-05-10";

/**
 * Creates a new valid request for each test.
 *
 * Each test changes only the field that it wants to examine. Returning a new
 * object prevents one test from accidentally changing another test's data.
 */
function createValidRequest(): EventRequestDraft {
  return {
    name: "ConnectSphere Conference",
    description: "An annual conference for alumni and industry partners.",
    eventType: "conference",
    expectedAttendance: 120,
    preferredDate: "2030-06-15",
    startTime: "09:00",
    endTime: "17:00",
    venue: {
      location: "Main Campus",
      capacity: 150,
      layout: "theatre",
      accessibility: ["Step-free access"],
      facilities: ["PA system"],
    },
    equipment: [
      {
        type: "Wireless microphone",
        quantity: 2,
        technicalRequirements: "Compatible receiver and spare batteries",
      },
    ],
    registration: {
      required: true,
      capacityLimit: 120,
      closingDate: "2030-06-10",
    },
  };
}

describe("US03 - Create Event Request - validation unit tests", () => {
  it("[US03-AC1] accepts a complete and valid event request", () => {
    // Given: a request containing valid information in every US03 section.
    const request = createValidRequest();

    // When: the event request is validated.
    const result = validateEventRequest(request, TODAY);

    // Then: validation succeeds and no field errors are returned.
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
  });

  it("[US03-AC5] reports all missing mandatory event-detail fields", () => {
    // Given: every mandatory basic event field is missing or invalid.
    const request = createValidRequest();
    request.name = "   ";
    request.description = "";
    request.eventType = "";
    request.expectedAttendance = 0;
    request.preferredDate = "";
    request.startTime = "";
    request.endTime = "";

    // When: the incomplete request is validated.
    const result = validateEventRequest(request, TODAY);

    // Then: validation fails and every mandatory field receives an error.
    expect(result.valid).toBe(false);
    expect(result.errors.name).toBeDefined();
    expect(result.errors.description).toBeDefined();
    expect(result.errors.eventType).toBeDefined();
    expect(result.errors.expectedAttendance).toBeDefined();
    expect(result.errors.preferredDate).toBeDefined();
    expect(result.errors.startTime).toBeDefined();
    expect(result.errors.endTime).toBeDefined();
  });

  it("[US03-AC6] rejects an event date in the past", () => {
    // Given: the preferred event date is one day before today.
    const request = createValidRequest();
    request.preferredDate = "2030-05-09";

    // When: the request is validated against the fixed current date.
    const result = validateEventRequest(request, TODAY);

    // Then: the date field receives an error.
    expect(result.valid).toBe(false);
    expect(result.errors.preferredDate).toBeDefined();
  });

  it("[US03-AC5-B01] rejects an end time that is not later than the start time", () => {
    // Given: the event ends at the same time that it starts.
    const request = createValidRequest();
    request.startTime = "09:00";
    request.endTime = "09:00";

    // When: the request is validated.
    const result = validateEventRequest(request, TODAY);

    // Then: the end-time field receives an error.
    expect(result.valid).toBe(false);
    expect(result.errors.endTime).toBeDefined();
  });

  it("[US03-AC5-B02] rejects zero expected attendance", () => {
    // Given: expected attendance is zero.
    const request = createValidRequest();
    request.expectedAttendance = 0;

    // When: the request is validated.
    const result = validateEventRequest(request, TODAY);

    // Then: the attendance field receives an error.
    expect(result.valid).toBe(false);
    expect(result.errors.expectedAttendance).toBeDefined();
  });

  it("[US03-AC5-B03] rejects negative expected attendance", () => {
    // Given: expected attendance is below zero.
    const request = createValidRequest();
    request.expectedAttendance = -1;

    // When: the request is validated.
    const result = validateEventRequest(request, TODAY);

    // Then: the attendance field receives an error.
    expect(result.valid).toBe(false);
    expect(result.errors.expectedAttendance).toBeDefined();
  });

  it("[US03-AC5-B04] rejects non-whole expected attendance", () => {
    // Given: expected attendance contains half a person.
    const request = createValidRequest();
    request.expectedAttendance = 120.5;

    // When: the request is validated.
    const result = validateEventRequest(request, TODAY);

    // Then: the attendance field receives an error.
    expect(result.valid).toBe(false);
    expect(result.errors.expectedAttendance).toBeDefined();
  });

  it("[US03-AC2] validates mandatory venue requirements", () => {
    // Given: the mandatory venue fields are missing or invalid.
    const request = createValidRequest();
    request.venue.location = "";
    request.venue.capacity = 0;
    request.venue.layout = "";

    // When: the request is validated.
    const result = validateEventRequest(request, TODAY);

    // Then: each invalid venue field receives an error.
    expect(result.valid).toBe(false);
    expect(result.errors["venue.location"]).toBeDefined();
    expect(result.errors["venue.capacity"]).toBeDefined();
    expect(result.errors["venue.layout"]).toBeDefined();
  });

  it("[US03-AC3] validates every supplied equipment requirement", () => {
    // Given: one equipment line has no type, quantity, or technical details.
    const request = createValidRequest();
    request.equipment = [
      {
        type: "",
        quantity: 0,
        technicalRequirements: "",
      },
    ];

    // When: the request is validated.
    const result = validateEventRequest(request, TODAY);

    // Then: every invalid part of the first equipment line receives an error.
    expect(result.valid).toBe(false);
    expect(result.errors["equipment.0.type"]).toBeDefined();
    expect(result.errors["equipment.0.quantity"]).toBeDefined();
    expect(result.errors["equipment.0.technicalRequirements"]).toBeDefined();
  });

  it("[US03-AC4] requires registration details when registration is enabled", () => {
    // Given: registration is enabled without a capacity or closing date.
    const request = createValidRequest();
    request.registration.required = true;
    request.registration.capacityLimit = null;
    request.registration.closingDate = null;

    // When: the request is validated.
    const result = validateEventRequest(request, TODAY);

    // Then: both conditional registration fields receive an error.
    expect(result.valid).toBe(false);
    expect(result.errors["registration.capacityLimit"]).toBeDefined();
    expect(result.errors["registration.closingDate"]).toBeDefined();
  });

  it("[US03-AC4-B01] rejects invalid registration details when registration is enabled", () => {
    // Given: registration fields exist but contain invalid values.
    const request = createValidRequest();
    request.registration.required = true;
    request.registration.capacityLimit = 0;
    request.registration.closingDate = "";

    // When: the request is validated.
    const result = validateEventRequest(request, TODAY);

    // Then: both invalid registration fields receive an error.
    expect(result.valid).toBe(false);
    expect(result.errors["registration.capacityLimit"]).toBeDefined();
    expect(result.errors["registration.closingDate"]).toBeDefined();
  });

  it("[US03-AC4-B02] allows empty registration details when registration is disabled", () => {
    // Given: registration is disabled and its conditional fields are empty.
    const request = createValidRequest();
    request.registration.required = false;
    request.registration.capacityLimit = null;
    request.registration.closingDate = null;

    // When: the request is validated.
    const result = validateEventRequest(request, TODAY);

    // Then: the optional registration fields do not make the request invalid.
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
  });

  it("[US03-AC3-B01] allows an empty equipment list when no equipment is required", () => {
    // Given: the organiser does not request any equipment.
    const request = createValidRequest();
    request.equipment = [];

    // When: the request is validated.
    const result = validateEventRequest(request, TODAY);

    // Then: an empty equipment list does not make the request invalid.
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
  });
});
