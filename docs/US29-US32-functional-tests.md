# US29-US32 Functional Test Cases

These cases cover the Sprint 2 attendee registration workflow. Record the deployed result and tester before marking a story Done.

| ID | Story | Preconditions | Steps | Expected result |
|---|---|---|---|---|
| FT-US29-01 | US29 | Attendee signed in; event is in Planning or Confirmed; registration is open; capacity remains | Open Browse events and select Register | Registration is stored as Registered, count increases once, on-screen confirmation appears, and an email confirmation notification is queued |
| FT-US29-02 | US29 | Attendee already has an active registration | Select Register again | No duplicate record is created and a reason is shown |
| FT-US29-03 | US29 | Event capacity is full | Select Join waitlist | A Waitlisted record is created and the confirmed registration count does not increase |
| FT-US29-04 | US29 | Registration closing date has passed | Attempt to register | Registration is rejected and the closing reason is shown |
| FT-US30-01 | US30 | Attendee has Registered, Waitlisted, or Withdrawn records | Open Browse events and scroll to My registrations | Each record shows its event, date/time, and current status |
| FT-US30-02 | US30 | A registered event is Cancelled | Open My registrations | Status is displayed as Cancelled while the history remains available |
| FT-US31-01 | US31 | Attendee has an active registration and withdrawal is allowed | Select Withdraw and confirm | Record changes to Withdrawn, a confirmed place is returned to capacity, and confirmation appears |
| FT-US31-02 | US31 | Attendee has an active registration | Select Withdraw and cancel the confirmation dialog | Registration and capacity remain unchanged |
| FT-US31-03 | US31 | Withdrawal deadline has passed | Confirm withdrawal | Withdrawal is rejected and the deadline reason is shown |
| FT-US32-01 | US32 | Organiser or Coordinator signed in and manages an event | Open Event registrations and select the event | Registration list and current count/capacity are displayed |
| FT-US32-02 | US32 | Managed event contains several statuses | Select a status filter | Only matching registrations are displayed |
| FT-US32-03 | US32 | A managed event is selected | Select Export CSV | A CSV containing the filtered records downloads |
| FT-US32-04 | US32 | User does not manage an event | Attempt to find the event in the selector | The event and its registrations are not available |

## Storage and rules

Registrations are saved in the database (`registrations` table) and survive reloads; every user sees the same records and places-taken count. The server (`backend/registrations.py`) checks the rules, counts places while the event is locked so two attendees can't take the last place, and moves the longest-waiting attendee up when a registered attendee withdraws. Withdrawal closes 7 days before registration closes (or on the event date when there is no closing date).

Remaining limitation: "email queued" is still an in-app notification; delivery through a real email provider is not implemented.
