# US23 — Approve or Reject Venue Booking

**Priority:** Must Have · **Estimate:** 5 points · **Updated by:** CR-W7-3 (AC6), CR-W7-4 (AC7)

> "As a Venue Staff member, I want to review and approve or reject a venue booking request,
> providing a reason where relevant, so that the Event Coordinator can proceed with planning."

Most of the decision flow was built with US22/US41 (`POST /bookings/{id}/decision`). US23 closes
the remaining gaps against its acceptance criteria and adds the tests that trace to them.

## Acceptance criteria and where they are tested

Test names carry the criterion ID (`[US23-AC5]` in TypeScript/Playwright, `test_US23_AC5_...` in Python).

| ID | Ensure that the Venue Staff member … | How | API / unit | Functional |
|---|---|---|---|---|
| AC1 | Can view all pending booking requests for the venues they manage | All Venue Staff manage every venue (decision below) | `test_US23_AC1_*` | ✓ |
| AC2 | Can open a request and view the event timing and venue requirements | Card shows date and times, the hold window with setup/teardown, attendance, layout, facilities and **accessibility needs** (added) | `test_US23_AC2_*` | ✓ |
| AC3 | Can approve or reject the request, with a mandatory reason on rejection | Existing; reason enforced by the server | `test_US23_AC3_*` | ✓ |
| AC4 | Has the booking status updated and the provisional hold either confirmed or released | Approved keeps the venue (a clashing request can't be approved); rejected frees it | `test_US23_AC4_*` | ✓ |
| AC5 | Has the requesting Event Coordinator notified of the outcome | **New:** the server marks decisions from the last 7 days (`decision_notice`); the coordinator sees "Venue booking approved / rejected (+ reason)" when their page loads | `test_US23_AC5_*` + `booking-decisions.unit.test.ts` | ✓ |
| AC6 | Reviews each booking request on its own, even when the same event has bookings at other venues | Existing (US41); one decision never changes the event's other bookings | `test_US23_AC6_*` | ✓ |
| AC7 | Cannot approve a tentative hold whose expiry time has passed | **New message:** "This tentative hold expired on … and can't be approved." (US42 makes the hold expire) | `test_US23_AC7_*` | ✓ |

```bash
python -m pytest tests/us23_booking_approval
npx vitest run tests/us23_booking_approval
npx playwright test tests/functional/us23-booking-approval.spec.ts
```

## Decisions (Sprint 3)

1. **AC1 — "the venues they manage" = every venue.** ConnectSphere's Venue Staff work as one team
   for all venues, so every Venue Staff member sees every pending request. There is no
   venue-to-staff link in the data. *To confirm with the Product Owner*; if venues are later given
   individual managers, the filter belongs in `GET /bookings`.
2. **AC5 — notifications on load.** Venue Staff decide in their own browser, so a notice added
   there never reached the coordinator. The server now marks each decision for 7 days and the
   coordinator's page turns those into notifications when it loads (as US42 does for holds).
   Notifications aren't stored on the server yet (US36), so they are shown on every load within
   those 7 days rather than once.

## Fixes found while testing

- **Rejecting a request left the dialog open.** After a decision the page re-read the event, but a
  rejected booking means the event no longer holds a venue, so Venue Staff aren't allowed to read it
  (403) and the page reported an error even though the rejection was saved. The page now applies the
  saved booking from the decision's response first and treats the re-read as best-effort.
- **A refused decision** (e.g. the hold expired, or a clash) now shows the server's reason and
  refreshes the request, instead of a generic error.

- **US39's functional test TC-US39-04** picked "the notification mentioning the event"; coordinators
  now also get "Venue booking approved" for it (AC5), so its locator was narrowed to the
  "Replacement venue required" notification. Its assertions are unchanged.

Depends on **US42** (hold expiry) for AC7.
