# US04 to US11 integration handover

## Scope and acceptance status

Requirement source: Week 7 Customer Changes, change 5, and approved US04 AC4.
New submissions enter an unassigned queue visible to the Event Coordinator Lead,
instead of being assigned directly to an Event Coordinator.

- US04 producer implementation: ready for handover.
- Lead role, authenticated queue and its UI: receiving-module dependency, to be
  coordinated with the US11 owner and the authentication owner.
- Cross-story integration design: prepared below, NOT executed.
- Full US04 AC4: pending; producer tests alone do not prove Lead visibility.
- US04 Story: retain In Progress until all valid AC and the Definition of Done
  are met. This handover does not move, remove or weaken AC4.

US11 assignment actions and US12 reassignment are outside this handover. Do not
implement them inside US04 solely to close the dependency.

## Existing producer contract (implemented)

FastAPI endpoint: POST /event-requests/submit. The Next.js proxy exposes it as
POST /api/event-requests/submit. Identity comes from the authenticated session.

Example request for a new event:

```json
{
  "event_information": {
    "name": "US04 Lead Queue Handover Test",
    "purpose": "Testing submission to the Lead queue",
    "pax": "85",
    "eventType": "",
    "date": "",
    "start": "18:00",
    "end": "21:00"
  },
  "draft_id": null
}
```

For an existing draft, supply its actual numeric ID in draft_id. A successful
request returns HTTP 201 with id, status, draft_form and submitted_at. The
existing draft retains its ID; a new submission gets a generated ID.

Persisted contract in the existing events table:

| Field | Producer guarantee | Receiver use |
| --- | --- | --- |
| id | Stable generated event ID | Match the same event across modules |
| status | submitted | Select submitted requests |
| coordinator_id | NULL | Select requests not yet assigned |
| organiser_id | Authenticated organiser's ID | Preserve ownership |
| name / purpose | Values supplied by the organiser | Display basic information |
| draft_form | Complete supplied form payload | Read other saved basic details |
| submitted_at | Server-generated submission time | Available for display/order |

Important compatibility boundary: pax, date, start, end and other form values
are currently retained in draft_form. Do not assume all equivalent normalised
event columns have been populated. Field names inside draft_form follow the
Next.js form (for example pax, not expected_attendance). This is an existing
representation, not a new customer requirement.

The organiser GET /event-requests endpoint is private to the organiser. Do not
reuse it for the Lead by removing its ownership filter. The receiving module
must provide its own authorised access to submitted, unassigned records.
No queue table or submission notification is needed for this handover.

## Consumer details to complete before execution

The US11/auth owners must record these actual implemented values here:

- Lead role identifier: UNRESOLVED (not yet implemented).
- Lead queue FastAPI path and response shape: UNRESOLVED.
- Lead UI URL, navigation labels and refresh behaviour: UNRESOLVED.
- Dedicated Lead test email/password or authorised credential reference:
  UNRESOLVED. Do not invent credentials or use Priya's coordinator account as a
  Lead account without an approved role change.
- Integration test file and command: UNRESOLVED until the real consumer exists.

These are execution blockers, not assumed endpoints. The producer contract
above can be consumed without waiting for all assignment actions to exist.

## Automated cross-story integration design (NOT executed)

Use the real FastAPI application, SQLAlchemy and an isolated test database.
Sign in with real session tokens; do not mock queue responses or bypass role
checks. Reuse the existing submission fixtures where practical. Extend a shared
queue integration suite if it already exists, instead of duplicating it by Story.

| Design ID | Setup and action | Required assertions |
| --- | --- | --- |
| US04-US11-INT01 | Authenticated organiser submits a new event; authenticated Lead reads the implemented queue in a fresh request/session. | Returned queue contains the exact submitted ID once, status submitted, no coordinator, and saved basic information. Queue reading adds no event rows. |
| US04-US11-INT02 | Organiser saves a draft and submits that same draft; Lead reads the queue. | Same ID appears once as submitted/unassigned; submission does not add a replacement event row. |
| US04-US11-INT03 | Fixtures contain a Draft, a submitted/unassigned event and a submitted/assigned event; Lead reads the unassigned queue. | Only the submitted/unassigned fixture appears. Use authorised test-fixture writes in the isolated database; no live assignment workflow is required for fixture setup. |
| US04-US11-INT04 | An unauthenticated client and authenticated non-Lead clients request the Lead queue. | HTTP 401 for no session and HTTP 403 for authenticated roles without queue permission, following existing API conventions; no private queue data is returned. |

Record actual results and the command only after executing against the real
consumer. SQLite tests do not prove PostgreSQL-specific locking behaviour. Do
not add skipped placeholder tests and count them as passed or as coverage.

## Manual acceptance design (US04-TC03; NOT execution-ready)

This is a draft specification for the shared blue/yellow TC template. Copy it
to the general test sheet only after replacing the unresolved Lead account,
route and navigation details with verified values. Do not claim it is ready to
reproduce while those details are missing. Preserve existing US04-TC01/TC02
execution records; this is a separate cross-module case.

### Test Case ID

US04-TC03

### Test Scenario

Verify a newly submitted organiser request is visible in the Lead's unassigned
queue after refresh and re-login, without direct coordinator assignment.

### Pre-conditions

- Both US04 and the real Lead queue/auth implementation are available.
- Start from the project root with npm run dev:all; open
  http://localhost:3000/login. Do not start duplicate services.
- Maya is an active organiser: maya.rahman@connectsphere.edu / maya12345.
- Supply the verified Lead account and queue navigation details listed above.
- Create a fresh event through the UI and capture its generated ID. Do not
  assume event 20 or 23 remains suitable for a later run.
- No additional SQL or continuous database monitoring is required for this UI
  case. The Lead queue and account may need setup by their owner first; any
  shared database changes require separately approved SQL. Do not reset shared
  tables or delete previous test records.

### Test Steps

1. Start the application and open http://localhost:3000/login.
   - If another account is signed in, click Sign out first.
2. Enter maya.rahman@connectsphere.edu and maya12345; click Sign in.
3. Open My Events and record the current total event count N.
4. Click New event request and enter the Basics values in Test Data.
5. Click Continue; check the Requirements values in Test Data.
6. Click Continue; check the Registration values in Test Data.
7. Click Submit for review once.
8. In My Events, capture the new ID as EVENT_ID.
   - Verify name, attendance 85, Submitted status and total count N + 1.
   - Verify Continue/Submit actions are absent for that event.
9. Click Sign out and open http://localhost:3000/login.
10. Enter the verified Lead email/password and click Sign in.
11. Open the implemented Lead unassigned queue using its verified navigation.
12. Find EVENT_ID, not merely the event name.
    - Verify it appears once with the submitted basic information.
    - Verify it is unassigned; do not assign a Coordinator during this case.
13. Refresh the queue and confirm EVENT_ID remains visible once and unassigned.
14. Sign out and sign in again with the same verified Lead credentials.
15. Reopen the queue and confirm the same result.
16. Finish the test without assigning, deleting or editing the event.
    - Append actual result, Pass/Fail/Blocked, remarks, executor and actual
      execution date/time in SGT to a new yellow record.
    - Leave earlier runs unchanged. Do not add Console steps.

### Test Data

- Organiser login: maya.rahman@connectsphere.edu / maya12345.
- Lead login and queue navigation: UNRESOLVED; fill before execution.
- Event name: US04 Lead Queue Handover Test.
- Purpose and description: Testing submission to the Lead queue.
- Expected attendance: 85.
- Event type: unselected; proposed date: blank; Start: 18:00; End: 21:00.
- Preferred venue location and required capacity: blank; Layout: Banquet.
- Facilities: PA system only; Accessibility: Step-free access only.
- Equipment: all quantities 0; no technical requirements.
- Enable attendee registration: checked; cap: 150; closing date: blank.
- EVENT_ID: capture the new numeric ID after submission.

### Expected Result

The same submitted event is visible once in the authorised Lead's unassigned
queue and stays visible after refresh/re-login. No Coordinator is directly
assigned and no duplicate event is created. The organiser cannot directly edit
the submitted request. This does not test assignment/reassignment actions.

### Created By / Date of Creation

Wen Yuetong / 2026-10-10 (SGT).

No yellow execution record is created here: this design has not been executed.

## Existing evidence and handover completion

- Producer unit tests: tests/unit/event_request/test_us04_event_submission.py.
- Producer API/database tests:
  tests/integration/test_us04_event_submission_integration.py.
- Existing US04-TC01/TC02 manual Pass records cover organiser submission,
  persistence and absence of direct-edit actions, not Lead visibility.
- To close AC4, the receiving owner must complete the unresolved consumer
  details, run the real integration checks, execute the final manual TC and
  record the evidence. A prepared test design is not a passing test.
