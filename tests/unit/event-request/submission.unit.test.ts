import { describe, expect, it } from "vitest";
import {
  canDirectlyEditEventRequest,
  submitEventRequest,
} from "../../../lib/event-request/submission";
import type { EventRequestDraft } from "../../../lib/types";

const NOW = new Date("2030-05-10T08:30:00.000Z");

/** Creates a fresh request that satisfies every US03 validation rule. */
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

describe("US04 - Submit Event Request - submission unit tests", () => {
  it("[US04-AC1] submits a complete and valid event request", () => {
    // Given: a request that satisfies all US03 validation rules.
    const request = createValidRequest();

    // When: the organiser submits the request.
    const result = submitEventRequest(request, NOW);

    // Then: submission succeeds.
    expect(result.ok).toBe(true);
  });

  it("[US04-AC1-AC2] blocks an invalid request and lists every outstanding field", () => {
    // Given: one request with four missing or invalid mandatory fields.
    const request = createValidRequest();
    request.name = "";
    request.description = "";
    request.eventType = "";
    request.expectedAttendance = 0;

    // When: the organiser attempts to submit the request.
    const result = submitEventRequest(request, NOW);

    // Then: submission is blocked and all four fields are reported together.
    expect(result).toEqual({
      ok: false,
      outstandingFields: [
        "name",
        "description",
        "eventType",
        "expectedAttendance",
      ],
    });
  });

  it("[US04-AC3] records Submitted status and the supplied ISO timestamp", () => {
    // Given: a complete request and a known submission time.
    const request = createValidRequest();

    // When: the organiser submits the request.
    const result = submitEventRequest(request, NOW);

    // Then: the submitted copy has the required status and timestamp.
    expect(result).toMatchObject({
      ok: true,
      request: {
        status: "submitted",
        submittedAt: "2030-05-10T08:30:00.000Z",
      },
    });
  });

  it("[US04-AC3-B01] preserves all event details in the submitted request", () => {
    // Given: a complete request kept for comparison.
    const request = createValidRequest();

    // When: the organiser submits the request.
    const result = submitEventRequest(request, NOW);

    // Then: the submitted copy still contains every original event detail.
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.request).toMatchObject(request);
    }
  });

  it("[US04-AC3-B02] does not mutate the original draft", () => {
    // Given: a request and a deep copy of its state before submission.
    const request = createValidRequest();
    const originalDraft = structuredClone(request);

    // When: the organiser submits the request.
    submitEventRequest(request, NOW);

    // Then: status and timestamp were not added to the editable draft object.
    expect(request).toEqual(originalDraft);
    expect(request).not.toHaveProperty("status");
    expect(request).not.toHaveProperty("submittedAt");
  });

  it("[US04-AC4-B01] allows direct editing while the request is a draft", () => {
    // Given: an event request with Draft status.
    const status = "draft";

    // When: the editing policy is checked.
    const editable = canDirectlyEditEventRequest(status);

    // Then: the organiser may continue editing the draft.
    expect(editable).toBe(true);
  });

  it("[US04-AC4] prevents direct editing after submission", () => {
    // Given: an event request with Submitted status.
    const status = "submitted";

    // When: the editing policy is checked.
    const editable = canDirectlyEditEventRequest(status);

    // Then: the organiser may no longer edit the request directly.
    expect(editable).toBe(false);
  });
});
