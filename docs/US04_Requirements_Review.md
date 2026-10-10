# US04 submission review

Reviewed and approved by Wen on 2026-10-10. Requirement corrections recorded
as US04-CHG-01 through US04-CHG-07 in the shared Change Log and applied to the
Notion US04 card. Python implementation and Lead queue dependency remain open.
No shared database changes have been executed.

Current handover update: the organiser submission producer is implemented and
its existing manual cases passed. The original gaps below describe the review
baseline, not all remaining work. Lead consumer integration remains pending.
See [US04/US11 integration handover](US04_US11_Integration_Handover.md) for the
implemented data contract and unexecuted cross-story test design. The Lead AC
is unchanged; do not mark the Story Done on the basis of producer tests alone.

## Evidence

- Week 4 Project Instructions, Event Request Creation: organisers can create and
  submit requests containing event name, purpose, description, proposed timing,
  expected attendance and relevant planning requirements. The list does not say
  that each item must be completed before submission.
- Week 1 Customer Briefing, Typical Process, Step 4: when information is
  incomplete or unclear, the coordinator requests clarification or amendment
  after submission and assignment. Missing information is not universally a
  submission blocker.
- Current-section instructor reply supplied by Wen: no default rejection;
  equipment outside the catalogue cannot be requested; post-submission changes
  are requested by the organiser and reviewed/decided by the coordinator.
  The reply refers mandatory fields to section clarification, but that specific
  clarification document has not been located in this review.
- Week 7 Customer Changes, change 5: new submissions enter an unassigned queue
  for the Event Coordinator Lead, not direct coordinator assignment.
- Week 7 Managing Changes, scenario 1: reopen an incomplete story when an
  original acceptance criterion was missed; verify the remaining valid criteria
  before marking Done again.

## Proposed backlog corrections

Story wording can remain: As an Event Organiser, I want to submit my completed
event request so that ConnectSphere can review it.

1. Rewrite "Can submit only when all mandatory fields are complete and valid":
   "The Event Organiser can submit an event request to ConnectSphere for review."
   Do not invent a required-field list. Revisit only if current-section written
   clarification explicitly identifies submission-required fields.
2. Remove "Is shown a list of outstanding mandatory fields when submission is
   blocked" as a customer AC until the prerequisite mandatory-field rule has a
   written source. Technical input errors can still be reported without claiming
   they are customer-required field rules.
3. Rewrite "Submitted status with a submission timestamp":
   "The saved event request is distinguishable as Submitted rather than Draft."
   Persist status. Keep submitted_at as an implementation/audit decision, not a
   separately confirmed customer AC.
4. Keep no direct organiser editing after submission, supported by the supplied
   section reply. A change-request workflow belongs to its own story.
5. Treat the existing on-screen confirmation as an implementation decision;
   no supplied sentence requires that exact customer AC. Keep useful feedback.
6. Add the Week 7 submission boundary: the submitted request is unassigned,
   available to the Lead queue, and not directly assigned to a coordinator.

## Current implementation gaps

- submission.ts and its tests assume the old US03 mandatory list.
- Both frontend submit paths update memory only; refresh restores a database
  draft and organiser editing remains possible.
- Current frontend sends prototype notifications to coordinators, not the Lead.
- The users role constraint/model currently has no Lead role. An unassigned
  record can use existing coordinator_id=NULL, but this alone does not deliver
  a queue accessible to an authenticated Lead.
- Existing UI combines purpose and description, although Week 4 lists both.
  Preserve this as a US03 data-capture gap; do not claim separate capture exists.

## Smallest proposed Python implementation

- Introduce a business submission module, not another draft module. Reuse the
  existing draft ownership/status rule and authenticated session.
- Persist a new submission or transition the existing owned draft to submitted
  in the existing events table. Preserve the saved information, server timestamp
  and coordinator_id=NULL. No drafts/event_requests table.
- Return persistent organiser event data so refresh retains Submitted; existing
  draft GET/PUT rules then reject direct editing of a submitted row.
- Replace TS submission decisions with FastAPI calls. Keep frontend display and
  input presentation in Next.js. Do not migrate unrelated US03 automatically.
- Unit tests cover pure submission preparation/rules. Integration tests cover
  actual FastAPI/SQLAlchemy persistence, ownership, status transitions and reload.
- Manual cases focus on submit, refresh/re-login and no Continue/edit action;
  no default Console/API commands. Preserve existing execution history.

## Approval and dependencies

Approve backlog corrections before changing rules/tests/code. The Lead role,
its authenticated queue and any database constraint change require explicit
scope coordination and approved SQL before shared database execution. This
review does not claim US04 complete or treat a NULL coordinator_id as a complete
Lead queue. Do not repeat completed US06 manual testing unless affected.
