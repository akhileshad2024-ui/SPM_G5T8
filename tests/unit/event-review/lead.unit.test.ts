/**
 * US43 — Event Coordinator Lead Oversight, and US11 — Assign Event Coordinator (unit).
 *
 * The rules in lib/events/review/lead.ts behind the Lead's Assignments page, the coordinator's
 * "Event assigned to you" notice and the "Assigned by" line, plus the Lead's role check (isLead),
 * the API mapping of the assignment record (eventFromApi) and the page title (getPageMeta).
 */
import { describe, expect, it } from "vitest";
import { eventFromApi, type StoredEvent } from "../../../lib/events/request/api";
import { assignmentNote, assignmentNotices, coordinatorWorkloads, unassignedRequests, waitingSubtitle } from "../../../lib/events/review/lead";
import { isCoordinator, isLead } from "../../../lib/events/review/shared";
import { getPageMeta } from "../../../lib/ui/page-meta";
import { COORDINATOR, LEAD, ORGANISER, createEvent } from "./fixtures";

const COORDINATORS = [{ id: 6, name: "Marcus Lee" }, { id: 5, name: "Priya Tan" }];
const unassigned = createEvent({ id: "EVT-1", name: "Open Day" });
const priyas = createEvent({ id: "EVT-2", name: "Workshop", coordinator: "Priya Tan", status: "under_review" });
const marcuss = createEvent({ id: "EVT-3", name: "Seminar", coordinator: "Marcus Lee", status: "approved" });
const alsoUnassigned = createEvent({ id: "EVT-4", name: "Hackathon" });
const EVENTS = [unassigned, priyas, marcuss, alsoUnassigned];

describe("US43 - the Lead's unassigned queue", () => {
  it("[US43-AC1] lists only the requests with no coordinator, in the order the server sent them", () => {
    expect(unassignedRequests(EVENTS).map((e) => e.id)).toEqual(["EVT-1", "EVT-4"]);
  });

  it("[US43-AC1] is empty once every request has a coordinator", () => {
    expect(unassignedRequests([priyas, marcuss])).toEqual([]);
  });

  it.each<[number, string]>([
    [0, "0 requests waiting for a coordinator"],
    [1, "1 request waiting for a coordinator"],
    [2, "2 requests waiting for a coordinator"],
  ])("[US43-AC1] with %i waiting, the page says \"%s\"", (n, text) => {
    const events = [priyas, ...[unassigned, alsoUnassigned].slice(0, n)];
    expect(waitingSubtitle(events)).toBe(text);
    expect(getPageMeta("/assignments", events)).toEqual({ title: "Assignments", subtitle: text });
  });
});

describe("US43 - each coordinator's current assignments", () => {
  it("[US43-AC2] lists each coordinator with only the events assigned to them", () => {
    expect(coordinatorWorkloads(EVENTS, COORDINATORS)).toEqual([
      { name: "Marcus Lee", events: [marcuss] },
      { name: "Priya Tan", events: [priyas] },
    ]);
  });

  it("[US43-AC2] a coordinator with nothing assigned is still listed, with no events", () => {
    expect(coordinatorWorkloads([unassigned], COORDINATORS)).toEqual([
      { name: "Marcus Lee", events: [] },
      { name: "Priya Tan", events: [] },
    ]);
  });

  it("[US43-AC2] an unassigned request is on no coordinator's list", () => {
    const listed = coordinatorWorkloads(EVENTS, COORDINATORS).flatMap((c) => c.events);
    expect(listed).not.toContain(unassigned);
    expect(listed).not.toContain(alsoUnassigned);
  });
});

describe("US43 - who is the Lead", () => {
  it("only the Lead role is the Event Coordinator Lead", () => {
    expect(isLead(LEAD)).toBe(true);
    expect(isLead(COORDINATOR)).toBe(false);
    expect(isLead(ORGANISER)).toBe(false);
  });

  it("the Lead is not an Event Coordinator, so can't run the coordinator's review steps", () => {
    expect(isCoordinator(LEAD)).toBe(false);
  });
});

describe("US11 - the recorded assignment", () => {
  const format = (iso: string) => `<${iso}>`;

  it("[US11-AC3] shows who assigned the coordinator and when", () => {
    expect(assignmentNote({ assignedBy: "Grace Ong", assignedAt: "2030-05-10T08:30:00Z" }, format))
      .toBe("Assigned by Grace Ong on <2030-05-10T08:30:00Z>");
  });

  it("[US11-AC3] leaves out the time when none was recorded", () => {
    expect(assignmentNote({ assignedBy: "Grace Ong", assignedAt: null }, format)).toBe("Assigned by Grace Ong");
  });

  it("[US11-AC3] shows nothing for an event with no recorded assignment", () => {
    expect(assignmentNote({ assignedBy: null, assignedAt: null }, format)).toBeNull();
    expect(assignmentNote({}, format)).toBeNull();
  });

  const stored = {
    id: 9, status: "submitted", name: "Charity Gala", organiser: "Maya Rahman", coordinator: "Priya Tan",
    purpose: "", eventType: "", pax: 50, date: "2030-06-01", start: "10:00:00", end: "12:00:00", venueLocation: "",
    venueCapacity: null, layout: null, facilities: [], access: [], equip: [], reg: false, regCap: null, regClose: null,
    venue: null, bookingState: null, equipState: null, draftForm: null, submittedAt: "2030-05-01T00:00:00Z",
    updatedAt: "2030-05-01T00:00:00Z",
  } as StoredEvent;

  it("[US11-AC3] keeps the assigning user and time sent by the server", () => {
    expect(eventFromApi({ ...stored, assignedBy: "Grace Ong", assignedAt: "2030-05-02T01:00:00Z" }))
      .toMatchObject({ assignedBy: "Grace Ong", assignedAt: "2030-05-02T01:00:00Z" });
  });

  it("[US11-AC3] an event the server sent without an assignment record has none", () => {
    expect(eventFromApi(stored)).toMatchObject({ assignedBy: null, assignedAt: null });
  });
});

describe("US11 - the assigned coordinator is notified", () => {
  it("[US11-AC4] one notice per assigned request not yet started, naming who assigned it", () => {
    expect(assignmentNotices([
      { name: "Charity Gala", status: "submitted", assignedBy: "Grace Ong" },
      { name: "Workshop", status: "under_review", assignedBy: "Grace Ong" },
      { name: "Seminar", status: "approved", assignedBy: "Grace Ong" },
    ])).toEqual([{ title: "Event assigned to you", body: "Grace Ong assigned Charity Gala to you." }]);
  });

  it("[US11-AC4] names the Lead generically when no assigner was recorded", () => {
    expect(assignmentNotices([{ name: "Open Day", status: "submitted", assignedBy: null }]))
      .toEqual([{ title: "Event assigned to you", body: "The Event Coordinator Lead assigned Open Day to you." }]);
  });

  it("[US11-AC4] no notices when nothing new is assigned", () => {
    expect(assignmentNotices([])).toEqual([]);
  });
});
