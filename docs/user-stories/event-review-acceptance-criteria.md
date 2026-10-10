# Event Review & Coordinator Assignment — Acceptance Criteria

Covers **US07, US08, US10, US11**. Each criterion ID (e.g. `US10-AC2`)
appears in the name of the tests that verify it, so a requirement can be
traced straight to its tests:

```bash
npx vitest run -t "US10-AC2"      # run the tests for one criterion
npm run test:us10                 # run every test for one story
```

Boundary / edge-case tests carry a `-Bnn` suffix (e.g. `US10-AC2-B01`).

| Story | Code | Tests |
|---|---|---|
| US07 | `lib/events/review/review.ts` | `tests/unit/event-review/review.unit.test.ts` |
| US08 | `lib/events/review/clarification.ts` | `tests/unit/event-review/clarification.unit.test.ts` |
| US10 | `lib/events/review/decision.ts` | `tests/unit/event-review/decision.unit.test.ts` |
| US11 | `lib/events/review/assignment.ts` | `tests/unit/event-review/assignment.unit.test.ts` |

Shared rules live in `lib/events/review/shared.ts`; `lib/state/app-context.tsx` only
applies each function's result (saves the event, sends notifications).

Each step is also saved by the backend (`backend/event_review.py`, same rules and
messages; endpoints in the README's "Event review" section), tested in
`tests/us07_us11_event_review/` (`python -m pytest tests/us07_us11_event_review`,
`npm run test:review`). The coordinator list for US11 comes from the Event
Coordinator accounts (`GET /coordinators`).

## Status flow

```
submitted ──start review──▶ under_review ──approve──▶ approved
                              │   ▲      └──reject───▶ rejected
            request clarif. / │   ┆ organiser responds
            amendment (US08)  ▼   ┆ (US09 — not in this set)
                         pending_clarification
```

## Related stories not covered here

- **US09** (organiser responds to a clarification request) moves a request from
  Pending clarification back to Under review. Until it is built, a request sent
  for clarification stays in Pending clarification.
- **US12** (reassign to another coordinator). US11 only assigns a coordinator
  to an unassigned event.

---

## US07 — Review submitted event requests

*As an Event Coordinator, I want to review submitted event requests so that I
can determine whether their requirements are sufficiently clear.*

- **AC1** Only Event Coordinators can open the review queue and start a review.
- **AC2** The queue lists every submitted (non-draft) request. Drafts are never shown.
- **AC3** Coordinators can narrow the queue (Needs action / Unassigned / Mine / All)
  and search by event name, organiser, or event ID (case-insensitive).
- **AC4** Opening a request shows every detail the organiser submitted. Optional
  sections that were left empty are labelled explicitly ("None requested", "Not specified").
- **AC5** The system flags requirements that look unclear or inconsistent:
  attendance above the requested venue capacity, a registration cap below the
  expected attendance, and equipment without technical requirements.
- **AC6** Starting a review moves a request from Submitted to Under review, adds it to
  the activity log, and notifies the organiser. Only Submitted requests can be moved into review.

## US08 — Request clarification or amendments

*As an Event Coordinator, I want to request clarification or amendments from the
Event Organiser so that missing or unclear requirements can be resolved.*

- **AC1** The coordinator can send either a clarification or an amendment request; the
  request moves to Pending clarification.
- **AC2** A message is required (1–1000 characters after trimming spaces).
- **AC3** The request type, message, coordinator and timestamp are recorded, added to the
  activity log, and sent to the organiser as a notification.
- **AC4** While Pending clarification, the request cannot be approved or rejected.
- **AC5** Only the assigned coordinator can send a request, and only while the request is Under review.

## US10 — Approve or reject an event request

*As an Event Coordinator, I want to approve or reject an event request and record
the decision so that the relevant users know the outcome.*

- **AC1** The coordinator can approve a request Under review, with an optional note
  (up to 1000 characters). The request moves to Approved.
- **AC2** Rejecting requires a reason of 10–1000 characters. The request moves to Rejected.
- **AC3** The decision is recorded — outcome, who decided, when, and any reason/note —
  and added to the activity log.
- **AC4** The organiser is notified of the outcome (including the rejection reason) and
  can view the reason from My Events.
- **AC5** Only the assigned coordinator can decide, only while the request is Under review,
  and only once a coordinator has been assigned.
- **AC6** A request that has been decided cannot be decided again.

## US11 — Assign an Event Coordinator

*As an authorised internal user, I want to assign an Event Coordinator to a
submitted event so that the event has a responsible internal contact.*

- **AC1** An unassigned event can be assigned to a coordinator from the coordinator
  roster; that coordinator becomes the main contact, and the assignment is logged.
- **AC2** The organiser and the coordinators are notified.
- **AC3** Only Event Coordinators can make assignments, and only people with the Event
  Coordinator role can be assigned.
- **AC4** Coordinators can be assigned only while the event is live (Submitted through
  Confirmed) — not to drafts or to rejected, cancelled, or completed events.
- **AC5** An event must have a coordinator before a review decision can be made (US10-AC5).
- **AC6** An event that already has a coordinator cannot be assigned again
  (changing the coordinator is reassignment, US12).

> "Authorised internal user" is implemented as the **Event Coordinator** role.
> Widening it (e.g. to a manager role) is a one-line change in `assignCoordinator`.
