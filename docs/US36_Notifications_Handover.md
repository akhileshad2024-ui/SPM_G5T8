# US36 Notifications — Handover for Sprint 4 stories

US36 delivers notifications for every story already built (see [the list](US36-functional-tests.md#which-notifications-are-sent)). The stories below are still being built, so their notification is **one line you add** in your endpoint, before `db.commit()`. Who receives it and what it says are already written and unit tested in `backend/messaging.py` (`tests/us36_notifications/test_us36_notifications_unit.py`).

Don't create notifications in the browser (`notify(...)` in `lib/state/app-context.tsx`): those only appear in the current user's own browser and are lost on reload. The page already polls `GET /notifications` every 15 seconds.

| Story | Owner | Call | Who gets it |
|---|---|---|---|
| US12-AC4 Reassign | Chin Hui | `messaging.coordinator_reassigned(db, event, previous_coordinator_id, user)` (after setting the new `event.coordinator_id`) | Outgoing coordinator, incoming coordinator, organiser |
| US14-AC4 Confirm | Chin Hui | `messaging.event_confirmed(db, event, user)` | Organiser, assigned technician, Venue Staff (if a venue is held); not the confirming coordinator |
| US44-AC2 / US36-AC7 Ready for safety check | Akhi | `messaging.safety_check_ready(db, event)` | Every active Safety Officer (finds `Role.safety` once you add it; sends nothing before then) |
| US44-AC6 / US36-AC7 Safety outcome | Akhi | `messaging.safety_check_decided(db, event, outcome, comment)` with `outcome` = `"approved"`, `"changes_requested"` or `"rejected"` | Coordinator |
| US49-AC3 Venue reassessment | Chin Hui | `messaging.venue_booking_reassess(db, booking)` | Every active Venue Staff member |
| US50-AC3 Equipment reassessment | Yangbo | `messaging.equipment_reassess(db, event)` | Assigned technician |
| US51-AC3 Registrations affected | Yangbo | `messaging.attendees_affected(db, event, "what changed for them")` | Registered and waitlisted attendees |

Example (US12):

```python
previous = event.coordinator_id
event.coordinator_id = new_coordinator.id
messaging.coordinator_reassigned(db, event, previous, user)
db.commit()
```

## Other things to know

- US14: `confirmEvent` in `lib/state/app-context.tsx` no longer makes browser-only notices; the confirm endpoint should call `event_confirmed`.
- US16, US33 and US34: their notifications are now sent (`details_changed`, `change_requested`, `change_decided`), so their US36 dependency is resolved.
- Removed, because the server sends these notices now: the browser helpers `assignmentNotices` (lib/events/review/lead.ts), `holdNotices` (lib/venues/hold-expiry.ts) and `decisionNotices` (the whole of lib/venues/booking-decisions.ts), with their unit tests. Their behaviour is covered in `tests/us36_notifications/`.
- A check that runs repeatedly (like the hold-expiry sweep) should use `messaging.notify_once`, which skips a notice the recipient already has.
- The backend starts a background thread (`messaging.sweep_holds_forever`) that checks hold expiry every minute. It runs inside `uvicorn`; nothing extra needs deploying.
