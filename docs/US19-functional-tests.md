# US19 View Venue Availability Calendar — Functional Test Cases

> "As an authorised internal user, I want to view a venue availability calendar showing bookings and recorded unavailable periods so that I can identify potential event times."

Automated in `tests/functional/us19-availability-calendar.spec.ts` (browser, run by CI on every pull request) and `tests/us19_availability_calendar/` (API and unit). The component's unit tests run in jsdom, with the server's reply faked (`availability-calendar.dom.unit.test.ts`).

| ID | AC | Preconditions | Steps | Expected result |
|---|---|---|---|---|
| TC-US19-01 | AC1, AC3, AC4 | A venue with 30 min setup and 45 min turnaround; Priya's event (10:00–12:00) has a booking Daniel approved | Sign in as Daniel; go to the event's date; choose the venue | The booking shows as Confirmed, 09:30–12:45, with "Event 10:00–12:00, 30 min setup, 45 min turnaround" |
| TC-US19-02 | AC1, AC4, AC6 | Priya has requested the venue; nobody has decided yet | Sign in as Daniel; go to the event's date; choose the venue | The request shows as Pending, in its own colour, with "Held until" and its expiry time |
| TC-US19-03 | AC1 | Daniel has recorded the venue as unavailable 08:00–20:00 for maintenance ("Floor repairs") | Sign in as Daniel; go to that date; choose the venue | "Maintenance: Floor repairs", 08:00–20:00, shows as Unavailable |
| TC-US19-04 | AC2 | The venue is unavailable on Wed 10 Mar 2027 | As Priya, open Venue calendar; go to that date; step to the next week and back; choose Day, then Month | The title follows each move, and the period shows on 10 Mar only, in every view |
| TC-US19-05 | AC5 | Priya's event has a confirmed booking at the venue | Sign in as Marcus, another coordinator; open Venue calendar; go to that date; choose the venue | The slot shows as "Booked" 09:30–12:45; the event's name is not on the page |
| TC-US19-06 | AC5 | — | Sign in as Wei, then Grace, then Maya; look for Venue calendar in the sidebar; as Maya, open `/calendar` directly | Wei and Grace open it; Maya has no link and is sent back to My events |

An expired hold shown as released (AC6) needs a hold's expiry to pass, so it is covered through the API (`TestAC6HoldExpiry` in `test_us19_calendar_api.py`) and in `calendar.unit.test.ts`.

## What each role sees

| Role | Calendar | Event names |
|---|---|---|
| Venue Staff | On Booking requests | Every booking |
| Event Coordinator | Venue calendar | Their own events; others show as "Booked" or "Tentative hold" |
| Event Coordinator Lead | Venue calendar | Live events |
| Technical Support | Venue calendar | Events whose equipment is assigned to them |
| Event Organiser, Attendee | No access (403 from the API) | — |

The server leaves the event's name and id out of its reply for a viewer who may not see that event (`backend/venue_calendar.py`), so the page has nothing to hide. Times are still sent: showing when a venue is busy is what the calendar is for.
