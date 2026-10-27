# US36 Receive Notifications — Functional Test Cases

> "As a user involved in an event, I want to receive notifications about significant decisions and changes relevant to me so that I know when information changes or action is required."

Automated in `tests/functional/us36-notifications.spec.ts` (browser, run by CI on every pull request) and `tests/us36_notifications/` (API and unit).

| ID | AC | Preconditions | Steps | Expected result |
|---|---|---|---|---|
| TC-US36-01 | AC1, AC2, AC6 | Maya has submitted a request; Grace (Lead) assigns it to Priya | Sign in as Priya; open Notifications | "Event assigned to you" is listed with the event name, says Grace assigned it, and says to open it from the queue |
| TC-US36-02 | AC3 | Priya has two unread notifications | Select "Mark as read" on one; reload; open Notifications | That one is read (no button); the other is still unread; both stay that way after the reload |
| TC-US36-03 | AC1 | Priya rejects Maya's request with a reason | Sign in as Maya; open Notifications | "Event request rejected" is listed with the event name and the reason |
| TC-US36-04 | AC4 | Grace assigns Maya's request to Priya | Sign in as Maya; open Notifications | Maya has no "Event assigned to you" notice: only the assigned coordinator gets it |
| TC-US36-05 | AC5 | Priya is signed in with the page open | Grace assigns a new request to Priya; open Notifications without reloading | The notice appears within one minute (the page checks every 15 seconds) |
| TC-US36-06 | AC7 | — | — | **Blocked by US44**: there is no Safety Officer role yet. `messaging.safety_check_ready` / `safety_check_decided` are ready and unit tested; this case is run once US44 calls them |
| TC-US36-07 | AC1 | Priya has approved Maya's request | As Priya, select "Open event" on "Event assigned to you"; then as Maya, on "Event request approved" | Priya lands on the event in her queue (shown even though it no longer needs action) and the notice is marked read; Maya lands on `/my-events/<id>` |
| TC-US36-08 | AC1 | Maya submits a request | Sign in as Grace (Lead); open Notifications | "New request to assign" is listed for the request, saying to assign a coordinator from Assignments |

## Which notifications are sent

Every notification is saved on the server in the same transaction as the step that causes it, for the person involved, never for a whole role. The text names the event, what changed, and what to do next. Each one has "Open event" (to the event, on the page that role works on it) and "Mark as read"; the panel shows the newest 200 and "Show older" pages back. Hold expiry is also checked every minute in the background, so those warnings go out even when nobody is using the app.

| Story | Trigger | Recipient | Title |
|---|---|---|---|
| US04 / US43 (US36-AC1) | Request submitted | Every active Event Coordinator Lead | New request to assign |
| US09 (US36-AC1) | Organiser replies to a clarification | Coordinator | Clarification answered |
| US11-AC4 / US36-AC6 | Lead assigns a coordinator | Assigned coordinator | Event assigned to you |
| US08-AC4 | Clarification or amendment requested | Organiser | Clarification requested / Amendment requested |
| US10-AC5 | Request approved or rejected | Organiser | Event request approved / rejected |
| US22-AC4 | Booking request submitted | Every active Venue Staff member | Booking request pending |
| US23-AC5 | Booking approved or rejected | Coordinator | Venue booking approved / rejected |
| US38-AC4 | Venue time change makes a booking clash | Coordinator | Booking requires reassessment |
| US39-AC5 | Venue marked unavailable over a booking | Coordinator | Replacement venue required |
| US42-AC3 | Hold within 24 h of expiry; hold expired | Coordinator (once each) | Venue hold expiring soon / Venue hold expired |
| US16-AC3 | Significant detail change | Organiser, assigned technician, Venue Staff (if a venue is held); not the editor | Event details changed |
| US33-AC2 | Organiser requests a change | Coordinator | Change requested |
| US34-AC5 | Change request decided | Requesting organiser | Change request accepted / rejected |
| US25-AC4, US26-AC4, US29-AC5 | Equipment request / status; registration (built in Sprint 3) | Technician / coordinator / attendee | (unchanged) |

Ready for stories still being built (see [the handover](US36_Notifications_Handover.md)): US12 reassignment, US14 confirmation, US44 safety check (US36-AC7), US49–US51 reassessment.
