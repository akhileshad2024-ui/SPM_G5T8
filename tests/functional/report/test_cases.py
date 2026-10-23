"""
The test-case specifications for the venue functional tests (US17, US18, US20, US21, US22, US37, US39):
the "written once" half of the test-case template. The Playwright specs in tests/functional/ carry
the same IDs in their titles, e.g. "[TC-US18-01]".

Keep a case here in step with its spec: the steps and data describe what the spec does.
"""

ENV = ("Functional-test servers running: Playwright starts the frontend (http://localhost:3100) and the backend "
       "(http://127.0.0.1:8100) on a throwaway SQLite database with the seeded test accounts. Never Supabase.")
COORD = "Signed in as the Event Coordinator (priya.tan@connectsphere.edu)."
STAFF = "Signed in as Venue Staff (daniel.ortiz@connectsphere.edu)."
PASSWORD = "Password=<functional-test password from tests/functional/support/seed_users.py>"
COORD_DATA = f"Email=priya.tan@connectsphere.edu; {PASSWORD}"
STAFF_DATA = f"Email=daniel.ortiz@connectsphere.edu; {PASSWORD}"

# An approved event used by US21/US22: made through the API as Maya (organiser), assigned to Priya, reviewed and approved.
EVENT = ("Event (Maya Rahman's request, assigned to Priya Tan, reviewed and approved): 120 people, theatre layout, "
         "needs a Projector and Wheelchair Access, on a future date, 10:00-12:00")

CASES = []


def case(id, story, ac, scenario, pre, steps, data, expected, gap=None):
    """`gap`: for a test that is expected to fail today because of a known limitation, what the tester sees."""
    CASES.append(dict(id=id, story=story, ac=ac, scenario=scenario, pre=pre, steps=steps, data=data, expected=expected, gap=gap))


# ------------------------------------------------------------------ US17 Maintain Venue Catalogue
case("TC-US17-01", "US17", "AC1", "Check Venue Staff can add a venue to the catalogue",
     f"{ENV} {STAFF}",
     ["Open Venue Catalogue", "Select + Add Venue", "Enter the venue name, location and capacity; tick layouts, facilities and an accessibility feature",
      "Select Save Venue"],
     f"{STAFF_DATA}\nName=<unique> Lecture Theatre; Location=North wing; Capacity=250; Layouts=Theatre, Classroom; Facilities=Projector, PA system; Accessibility=Wheelchair Access",
     "A message says the venue was added to the catalogue, and a card for the venue appears in the catalogue.")
case("TC-US17-02", "US17", "AC1", "Check Venue Staff can edit a venue",
     f"{ENV} {STAFF} A venue exists with capacity 200.",
     ["Open Venue Catalogue", "Select Edit on the venue's card", "Change Capacity to 320", "Select Save Venue", "Reload the page"],
     f"{STAFF_DATA}\nCapacity 200 -> 320",
     "A message says the venue was updated; the card shows capacity 320, also after reloading the page.")
case("TC-US17-03", "US17", "AC1", "Check Venue Staff can deactivate a venue and reactivate it",
     f"{ENV} {STAFF} An active venue exists.",
     ["Open Venue Catalogue", "Select Deactivate on the venue's card, then Deactivate venue", "Tick Show deactivated", "Select Reactivate on the venue's card"],
     STAFF_DATA,
     "The venue disappears from the default list with a message that it was deactivated; under Show deactivated it carries a Deactivated tag; "
     "after Reactivate the tag is gone and a message says it was reactivated.")
case("TC-US17-04", "US17", "AC1", "Check a venue cannot be deleted, only deactivated",
     f"{ENV} {STAFF} An active venue exists.",
     ["Open Venue Catalogue and look at the venue's card", "Send a delete request for the venue (DELETE /venues/{id}) as Venue Staff"],
     STAFF_DATA,
     "The card has no Delete or Remove button. The delete request is refused with 409 and a message to deactivate the venue instead.")
case("TC-US17-05", "US17", "AC2", "Check the venue records capacity, location, facilities, accessibility and layouts",
     f"{ENV} {STAFF}",
     ["Open Venue Catalogue", "Add a venue with a location, capacity 80, two layouts, two facilities and one accessibility feature", "Select Save Venue",
      "Read the new venue's card"],
     f"{STAFF_DATA}\nLocation=<unique> East block; Capacity=80; Layouts=Theatre, Classroom; Facilities=Projector, PA system; Accessibility=Wheelchair Access",
     "The card shows the location, capacity 80, both layouts, both facilities and the accessibility feature.")
case("TC-US17-06", "US17", "AC2", "Check accessibility can only be chosen from the fixed set of features",
     f"{ENV} {STAFF}",
     ["Open Venue Catalogue", "Select + Add Venue", "Read the Accessibility Features section"],
     STAFF_DATA,
     "The section offers exactly Wheelchair Access, Special Physical Seating and Mobility/Facility Arrangements as tick boxes, with no free-text field.")
case("TC-US17-07", "US17", "AC3", "Check missing or invalid values show validation errors and nothing is saved",
     f"{ENV} {STAFF}",
     ["Open Venue Catalogue and select + Add Venue", "Select Save Venue with every field empty", "Enter a name and location, set Capacity to 0, select Save Venue"],
     f"{STAFF_DATA}\nCapacity=0",
     "Empty form: 'Enter the venue name.', 'Enter where the venue is.' and 'Capacity must be a whole number greater than 0.' are shown. "
     "Capacity 0: the capacity error is shown. The form stays open and no venue is added.")
case("TC-US17-08", "US17", "AC5", "Check each change is recorded with the editing user and a timestamp",
     f"{ENV} {STAFF} A venue exists with capacity 200.",
     ["Open Venue Catalogue", "Edit the venue and change Capacity to 260; Save Venue", "Read the 'Last changed by' line on the card",
      "Read the venue's change history (GET /venues/{id}/history)"],
     f"{STAFF_DATA}\nCapacity 200 -> 260",
     "The card shows 'Last changed by daniel.ortiz@connectsphere.edu' with a time. The history lists 'create' then 'edit', both by Daniel Ortiz with a timestamp; "
     "the edit records capacity 200 -> 260.")
case("TC-US17-09", "US17", "RBAC", "Check only Venue Staff can maintain the catalogue",
     f"{ENV} An active venue exists. Signed in as the Event Coordinator.",
     ["As the coordinator, send an edit (PUT /venues/{id}) and an add (POST /venues) request", "Open /catalogue in the browser"],
     COORD_DATA,
     "Both requests are refused with 403 and /catalogue redirects the coordinator away from the page.")

# ------------------------------------------------------------------ US18 View Venue Details
case("TC-US18-01", "US18", "AC1", "Check a coordinator can open the full details of an active venue",
     f"{ENV} {COORD} An active venue exists.",
     ["Open Venues", "Read the right-hand panel", "Select View details on the venue"],
     f"{COORD_DATA}\nVenue: <unique> Lecture Theatre, capacity 150",
     "Before choosing, the panel says 'Choose a venue to see its details.' After View details it shows the venue's details panel headed with the venue's name.")
case("TC-US18-02", "US18", "AC2", "Check the details show capacity, location, facilities, accessibility and layouts",
     f"{ENV} {COORD} A venue exists with capacity 150, two layouts, two facilities and two accessibility features.",
     ["Open Venues", "Select View details on the venue", "Read the details panel"],
     f"{COORD_DATA}\nLayouts=Theatre, Classroom; Facilities=Projector, PA system; Accessibility=Wheelchair Access, Special Physical Seating",
     "The panel shows the location, capacity 150, both layouts, both facilities and both accessibility features.")
case("TC-US18-03", "US18", "AC3", "Check the coordinator's view is read-only and the venue cannot be edited",
     f"{ENV} {COORD} An active venue exists.",
     ["Open Venues and select View details", "Look for inputs, dropdowns or buttons inside the details panel", "Open /catalogue",
      "Send an edit request for the venue (PUT /venues/{id}) as the coordinator"],
     COORD_DATA,
     "The details panel has no inputs, dropdowns or buttons. /catalogue redirects the coordinator away with no + Add Venue button. The edit request is refused with 403.")
case("TC-US18-04", "US18", "AC4", "Check a deactivated venue is left out of the list",
     f"{ENV} {COORD} Two venues exist; one has been deactivated by Venue Staff.",
     ["Open Venues", "Read the venue list"],
     COORD_DATA,
     "The active venue is listed; the deactivated venue is not.")

# ------------------------------------------------------------------ US20 Search and Filter Venues
FILTER_PRE = f"{ENV} {COORD} Venues exist in a location of their own, so other venues do not affect the result."
case("TC-US20-01", "US20", "AC1", "Check venues can be searched by expected attendance",
     FILTER_PRE,
     ["Open Venues", "Choose the location", "Enter Expected attendance 120", "Select Search"],
     f"{COORD_DATA}\nVenue capacities 50, 120 and 300; Expected attendance=120",
     "The venues with capacity 120 (equal to the attendance) and 300 are listed; the venue with capacity 50 is not. '2 venues found' is shown.")
case("TC-US20-02", "US20", "AC1", "Check venues can be searched by location",
     FILTER_PRE,
     ["Open Venues", "Choose one of the two locations from the Location dropdown", "Select Search"],
     f"{COORD_DATA}\nTwo venues at different locations",
     "Only the venue at the chosen location is listed.")
case("TC-US20-03", "US20", "AC1", "Check venues can be searched by layout",
     FILTER_PRE,
     ["Open Venues", "Choose the location", "Choose Layout=Boardroom", "Select Search"],
     f"{COORD_DATA}\nOne theatre-only venue, one boardroom-only venue",
     "Only the boardroom venue is listed.")
case("TC-US20-04", "US20", "AC1", "Check venues can be searched by required facilities (all must be offered)",
     FILTER_PRE,
     ["Open Venues", "Choose the location", "Tick Projector and Stage", "Select Search"],
     f"{COORD_DATA}\nOne venue with Projector and Stage, one with Projector only",
     "Only the venue offering both facilities is listed.")
case("TC-US20-05", "US20", "AC1", "Check venues can be searched by accessibility feature",
     FILTER_PRE,
     ["Open Venues", "Choose the location", "Tick Special Physical Seating", "Select Search"],
     f"{COORD_DATA}\nOne venue with Wheelchair Access and Special Physical Seating, one with Wheelchair Access only",
     "Only the venue offering Special Physical Seating is listed.")
case("TC-US20-06", "US20", "AC1", "Check venues can be searched by date and time",
     FILTER_PRE,
     ["Open Venues", "Choose the location", "Enter a date 20 days ahead, Start time 10:00, End time 12:00", "Select Search"],
     f"{COORD_DATA}\nOne free venue; one venue under maintenance 09:00-13:00 on that date",
     "The free venue is listed; the venue under maintenance is not.")
case("TC-US20-07", "US20", "AC2", "Check several filters can be applied together and cleared one at a time",
     FILTER_PRE,
     ["Open Venues", "Choose the location, Expected attendance 100, Layout=Theatre, tick Projector; select Search",
      "Read the results and the filter chips", "Select the x on the Layout chip", "Select the x on the Expected attendance chip"],
     f"{COORD_DATA}\nVenues: capacity 200 theatre; capacity 200 boardroom-only; capacity 50 theatre (all with Projector)",
     "With all filters only the matching venue is listed and Location, Expected attendance, Layout and Facilities each have a chip. "
     "Clearing Layout adds the boardroom venue; clearing Expected attendance then adds the small venue; the other filters stay applied.")
case("TC-US20-08", "US20", "AC3", "Check only venues that are free for the period are shown",
     FILTER_PRE,
     ["Open Venues", "Choose the location", "Enter a date 21 days ahead, Start time 10:00, End time 12:00", "Select Search"],
     f"{COORD_DATA}\nVenues: open every day 06:00-23:00; closed on that weekday; open only 13:00-22:00",
     "Only the venue that is open every day is listed ('1 venue found'). The venue closed on that weekday and the venue that opens at 13:00 are not.")
case("TC-US20-09", "US20", "AC4", "Check the coordinator is told when no venue matches, with the applied filters shown",
     FILTER_PRE,
     ["Open Venues", "Choose the location", "Enter Expected attendance 9999", "Select Search"],
     f"{COORD_DATA}\nOne venue with capacity 100",
     "'No venues match the filters applied.' is shown, with 'Filters applied' listing 'Location: <location>' and 'Expected attendance: 9999'.")
case("TC-US20-10", "US20", "AC5", "Check search results come back within 3 seconds",
     FILTER_PRE,
     ["Open Venues", "Choose the location, Expected attendance 50, tick Projector, enter a date and 10:00-12:00", "Select Search and time how long the results take"],
     f"{COORD_DATA}\n5 venues in the location",
     "The 5 results are shown in under 3 seconds.")

# ------------------------------------------------------------------ US21 Check Venue Suitability
VENUE_TAB = ["Open the Review queue, show All, search for the event and open it", "Open the Venue tab and set Minimum capacity to 0"]
case("TC-US21-01", "US21", "AC1", "Check each candidate venue is marked suitable, partially suitable or unsuitable",
     f"{ENV} {COORD} {EVENT}. Three venues exist: one that fits, one with no projector, one with capacity 50.",
     VENUE_TAB + ["Read the verdict on each venue"],
     COORD_DATA,
     "The fitting venue is Suitable, the venue without a projector is Partially suitable, the venue with capacity 50 is Unsuitable.")
case("TC-US21-02", "US21", "AC2", "Check every unmet requirement is shown with the reason",
     f"{ENV} {COORD} {EVENT}. A venue exists with capacity 50, banquet layout only, no facilities and no accessibility features.",
     VENUE_TAB + ["Read the reasons listed on that venue"],
     COORD_DATA,
     "The venue is Unsuitable and lists: 'Capacity 50 is below the expected attendance of 120.', 'Does not support a theatre layout.', "
     "'Projector is not available at this venue.' and 'Wheelchair Access is not provided at this venue.'")
case("TC-US21-03", "US21", "AC3", "Check the comparison with the event's recorded venue needs can be seen",
     f"{ENV} {COORD} {EVENT}. A venue exists with capacity 50 that offers a Projector, Wheelchair Access and the theatre layout.",
     VENUE_TAB + ["Select 'Compared with this event's venue needs' on that venue", "Read the table"],
     COORD_DATA,
     "The table lists Capacity (needs 120 people, offers 50 people, not met), Layout, Facility: Projector, Accessibility: Wheelchair Access and Availability "
     "for the event's date and 10:00-12:00, each with what the event needs and what the venue offers.")
case("TC-US21-04", "US21", "AC4", "Check the coordinator can still request an unsuitable venue after acknowledging the warning",
     f"{ENV} {COORD} {EVENT}. A venue exists with capacity 50.",
     VENUE_TAB + ["Select Request anyway... on the unsuitable venue", "Try Request booking anyway without ticking the acknowledgement",
                  "Tick 'I acknowledge the warning...'", "Select Request booking anyway"],
     COORD_DATA,
     "A warning says the venue is unsuitable. Request booking anyway is disabled until the box is ticked. After ticking it the booking is requested "
     "('Booking requested at <venue>.') and the venue shows Requested.")
case("TC-US21-05", "US21", "AC5", "Check the override is recorded against the event",
     f"{ENV} {COORD} {EVENT}. A venue exists that lacks only the projector (partially suitable).",
     VENUE_TAB + ["Request that venue anyway and acknowledge the warning", "Read the Venue tab", "Open the Activity tab"],
     COORD_DATA,
     "The Venue tab shows 'Overrides recorded against this event' with the reason 'Projector is not available at this venue.' and the Activity tab "
     "logs 'Venue override acknowledged' naming the coordinator and that the venue is partially suitable.")
case("TC-US21-06", "US21", "AC5", "Check the recorded override is still there after the page is reloaded",
     f"{ENV} {COORD} {EVENT}. A venue exists that lacks only the projector. The coordinator has requested it anyway.",
     ["Reload the page", "Open the event again and its Venue tab"],
     COORD_DATA,
     "The Venue tab still shows 'Overrides recorded against this event' with the reason 'Projector is not available at this venue.'")

# ------------------------------------------------------------------ US22 Submit Venue Booking Request
VENUE22 = "A venue exists with capacity 200, theatre layout, a Projector, Wheelchair Access, 30 min setup and 45 min turnaround."
case("TC-US22-01", "US22", "AC1", "Check the request holds the event date, times, setup and teardown, attendance and layout",
     f"{ENV} {COORD} {VENUE22} {EVENT}.",
     VENUE_TAB + ["Select Request booking on the suitable venue", "Read the request the page sent and the booking returned", "Open the Activity tab"],
     COORD_DATA,
     "The page sends only the event (no setup or teardown entered). The saved booking records the event's date, 10:00, 12:00, attendance 120 and theatre layout, "
     "plus setup 30 min and teardown 45 min taken from the venue, and holds the venue 09:30-12:45. The Activity tab logs the request including the setup and teardown.")
case("TC-US22-02", "US22", "AC2", "Check a request can only be made for an event with Approved status",
     f"{ENV} {COORD} {VENUE22} An event that is under review but not yet approved, one waiting on clarification and one that was rejected (the last two are tested through the API).",
     ["Open the Review queue and open the under-review event", "Open the Venue tab and read the note on the venue", "Select Request booking",
      "Send booking requests as the coordinator for the event waiting on clarification and for the rejected event"],
     COORD_DATA,
     "The venue says 'A venue can only be requested for an approved event.', pressing Request booking shows that message and sends no request. "
     "The server refuses both of the other events with 409 and a message naming the status.")
case("TC-US22-03", "US22", "AC3", "Check the request is recorded as Pending and the venue is provisionally held",
     f"{ENV} {COORD} {VENUE22} Two approved events (120 people, theatre, 10:00-12:00 on the same date).",
     ["Open the first event's Venue tab and select Request booking on the venue", "Read the venue's button, its note and the event header",
      "Open the second event's Venue tab and read the verdict and reasons for the same venue"],
     COORD_DATA,
     "The booking is recorded with status 'pending'; the venue shows Requested with 'Awaiting Venue Staff' and the header shows 'Awaiting venue decision'. "
     "For the second event the venue is Unsuitable: 'Clashes with <first event>, already requested on <date>'.")
case("TC-US22-04", "US22", "AC4", "Check Venue Staff are notified of the new request",
     f"{ENV} {COORD} {VENUE22} {EVENT}.",
     VENUE_TAB + ["Select Request booking on the venue", "Read the notification returned for Venue Staff"],
     COORD_DATA,
     "The notification is addressed to Venue Staff, titled 'Booking request pending', and says '<venue> requested for <event> on <date>, 10:00-12:00 (120 people, theatre layout).'")
case("TC-US22-05", "US22", "AC4", "Check Venue Staff can see the new request when they sign in",
     f"{ENV} {VENUE22} {EVENT}. The coordinator has requested the venue.",
     ["In a separate browser, sign in as Venue Staff", "Read the Booking requests page"],
     STAFF_DATA,
     "The pending request for the event is listed for Venue Staff, showing the venue, the hold with 30 min setup and 45 min teardown, and the Approve booking and Reject with reason buttons.")
case("TC-US22-06", "US22", "AC3", "Check the pending request is still there after the page is reloaded",
     f"{ENV} {COORD} {VENUE22} {EVENT}. The coordinator has requested the venue.",
     ["Reload the page", "Open the event and its Venue tab"],
     COORD_DATA,
     "The venue still shows Requested, with 'Awaiting Venue Staff', for the event.")
case("TC-US22-07", "US22", "AC5", "Check a second pending request for the same venue and time period is refused",
     f"{ENV} {COORD} {VENUE22} Two approved events (same date, 10:00-12:00). The first already has a pending request for the venue.",
     ["Open the second event's Venue tab", "Select Request anyway... on the venue", "Tick the acknowledgement", "Select Request booking anyway"],
     COORD_DATA,
     "The request is refused with '<venue> already has a pending request for that period (<first event>).' and the venue does not show as Requested for the second event.")
case("TC-US22-08", "US22", "AC5", "Check a request straight after the first one's setup and teardown is accepted",
     f"{ENV} {COORD} {VENUE22} The first event (10:00-12:00) already has a pending request, so the venue is held 09:30-12:45. A second approved event runs 13:15-15:00.",
     ["Open the second event's Venue tab", "Read the venue's verdict", "Select Request booking"],
     f"{COORD_DATA}\nSecond event's setup starts 13:15 - 30 min = 12:45, exactly when the hold ends",
     "The venue is Suitable for the second event and its request is accepted as pending.")

case("TC-US22-09", "US22", "AC3", "Check Venue Staff can approve the request and the coordinator sees the confirmed booking",
     f"{ENV} {VENUE22} {EVENT}. The coordinator has requested the venue.",
     ["In a separate browser, sign in as Venue Staff", "Select Approve booking on the event's request", "As the coordinator, reload the page and open the event's Venue tab"],
     f"{STAFF_DATA}",
     "A message says the venue is confirmed for the event. After a reload the coordinator's Venue tab shows the venue as Booked ('Confirmed booking').")
case("TC-US22-10", "US22", "AC3", "Check when Venue Staff reject the request the venue is released for other events",
     f"{ENV} {VENUE22} Two approved events (same date, 10:00-12:00). The coordinator has requested the venue for the first.",
     ["In a separate browser, sign in as Venue Staff", "Select Reject with reason and confirm with the box empty", "Enter a reason and confirm",
      "As the coordinator, reload the page, open the second event's Venue tab and request the venue"],
     f"{STAFF_DATA}\nReason=Held for setup that morning.",
     "The empty rejection is refused ('Give a reason for rejecting the request.'). With a reason the booking is rejected. The venue then shows as Suitable for the second event "
     "and its request is accepted as pending.")

# ------------------------------------------------------------------ US37 Configure Venue Setup and Turnaround Time
case("TC-US37-01", "US37", "AC1", "Check Venue Staff can set setup and turnaround minutes for a venue",
     f"{ENV} {STAFF}",
     ["Open Venue Catalogue, + Add Venue, fill in the name, location and capacity", "Set Setup 30 and Turnaround 45; Save Venue", "Read the card",
      "Edit the venue, set Setup 15 and Turnaround 20; Save Venue", "Reload the page and read the card"],
     f"{STAFF_DATA}\nSetup=30, Turnaround=45, then 15 and 20",
     "The card first shows 'Setup: 30 min · Turnaround: 45 min', then 'Setup: 15 min · Turnaround: 20 min', also after a reload.")
case("TC-US37-02", "US37", "AC2", "Check a missing or negative value shows a validation error and nothing is saved",
     f"{ENV} {STAFF}",
     ["Open Venue Catalogue, + Add Venue and fill in the name, location and capacity",
      "Try Setup empty, Turnaround empty, Setup -5, Turnaround -1 and Setup 1441, selecting Save Venue each time",
      "Set Setup 0 and Turnaround 1440 and select Save Venue", "Send new-venue requests to the server without setupMinutes, then without turnaroundMinutes"],
     f"{STAFF_DATA}\nValues: empty, empty, -5, -1, 1441; then 0 and 1440",
     "Each invalid value shows 'Enter whole minutes from 0 to 1440.' and the form stays open. 0 and 1440 are accepted. "
     "The server refuses (422) a venue sent without setup minutes and one sent without turnaround minutes.")
case("TC-US37-03", "US37", "AC3", "Check each change is recorded with the editing user and a timestamp",
     f"{ENV} {STAFF} A venue exists with Setup 30 and Turnaround 45.",
     ["Open Venue Catalogue and Edit the venue", "Set Setup 10 and Turnaround 60; Save Venue", "Read the 'Last changed by' line", "Read the venue's change history (GET /venues/{id}/history)"],
     f"{STAFF_DATA}\nSetup 30 -> 10; Turnaround 45 -> 60",
     "The card shows 'Last changed by daniel.ortiz@connectsphere.edu'. The history's latest 'edit' is by Daniel Ortiz with a timestamp and records setup 30 -> 10 and turnaround 45 -> 60.")
case("TC-US37-04", "US37", "AC4", "Check venue search treats a venue as occupied from start minus setup to end plus turnaround",
     f"{ENV} {COORD} Two venues in one location, both under maintenance 10:00-12:00 on a future date: one with 30 min setup and 45 min turnaround, one with none.",
     ["Open Venues, choose the location and the date",
      "Search 12:30-14:00, 12:29-14:00, 12:15-14:00, 08:00-09:15 and 08:00-09:16, reading which venues are listed each time"],
     f"{COORD_DATA}\nMaintenance 10:00-12:00",
     "The venue with setup and turnaround is listed for 12:30-14:00 and 08:00-09:15 (touching the maintenance) and not for 12:29-14:00, 12:15-14:00 or 08:00-09:16. "
     "The venue with no setup or turnaround is listed every time.")
case("TC-US37-05", "US37", "AC5", "Check a booking request takes setup and teardown from the venue, not from per-booking entry",
     f"{ENV} {COORD} A venue with Setup 20 and Turnaround 60, and an approved event (120 people, theatre, 10:00-12:00) it suits.",
     ["Open the event's Venue tab", "Look for any setup or teardown field", "Select Request booking and read the request sent and the booking returned"],
     f"{COORD_DATA}\nVenue Setup=20, Turnaround=60",
     "The Venue tab has no setup or teardown field and the request contains none. The booking records setup 20 min and teardown 60 min and holds the venue 09:40-13:00.")

# ------------------------------------------------------------------ US39 Mark Venue Temporarily Unavailable
BOOKED = "A venue with setup 30 min and turnaround 45 min, and an approved event on a future date 10:00-12:00 whose booking of it Venue Staff approved."
case("TC-US39-01", "US39", "AC1", "Check Venue Staff can record an unavailable period with a start, an end and a reason",
     f"{ENV} {STAFF} A venue exists with no unavailable periods.",
     ["Open Venue Catalogue and Edit the venue", "Select + Add unavailable period and read the Reason options",
      "Enter an end before the start; Save Venue", "Fix the end, choose Other with no note; Save Venue", "Add a note; Save Venue"],
     f"{STAFF_DATA}\nPeriod=<date> 12:00 to 08:00, then 12:00 to 18:00; Reason=Other; Note=Flooded after the storm",
     "The reasons are Maintenance, Equipment failure, Renovation, Safety concern, Internal activity and Other. An end before the start shows "
     "'The end must be after the start.'; Other with no note shows 'Add a note when the reason is \"Other\".'. With a note the venue is updated "
     "and the period is saved with its start, end, reason and note.")
case("TC-US39-02", "US39", "AC2", "Check the venue is left out of venue search for the period",
     f"{ENV} {COORD} A venue in a location of its own, open that day.",
     ["Open Venues, choose the location; search the date 10:00-12:00", "Venue Staff records Renovation 08:00-20:00 on that date",
      "Search the same date and time again", "Search the next day"],
     f"{COORD_DATA}\nPeriod=<date> 08:00-20:00, Renovation",
     "The venue is listed before the period is recorded, not listed during the period, and listed again the next day. "
     "(The calendar half of AC2 waits for US19: the Bookings calendar still shows one fixed week.)")
case("TC-US39-03", "US39", "AC3, AC4", "Check an overlapping booking is flagged, kept, and the event left unchanged",
     f"{ENV} {STAFF} {BOOKED}",
     ["Open Venue Catalogue and Edit the venue", "Add an unavailable period over the booking (Maintenance); Save Venue",
      "Open Booking requests", "Read the booking (GET /bookings) and the event (GET /events/{id})"],
     f"{STAFF_DATA}\nPeriod=<date> 08:00-20:00, Maintenance",
     "The message says '<venue> updated. 1 booking flagged to coordinators.' and the event is listed under 'Confirmed bookings needing attention'. "
     "The booking is still approved and carries a 'venue_unavailable' flag saying a replacement venue is required; the event's status, name, date, "
     "times, venue and booking state are unchanged.")
case("TC-US39-04", "US39", "AC5", "Check the event's coordinator is notified that a replacement venue is required",
     f"{ENV} {COORD} {BOOKED} Venue Staff then marked the venue unavailable over the booking (Safety concern, note 'Ceiling repair').",
     ["Sign in as the coordinator", "Open Notifications", "Open the event in the Review queue and its Venue tab"],
     f"{COORD_DATA}",
     "Notifications holds 'Replacement venue required' for the event, naming 'Safety concern: Ceiling repair'. The Venue tab shows "
     "'Alternative arrangements needed for <venue>.'")
case("TC-US39-05", "US39", "AC6", "Check Venue Staff can edit a period or end it early, and the flag follows",
     f"{ENV} {STAFF} {BOOKED} The venue is unavailable over the booking (Maintenance 08:00-20:00), so the booking is flagged.",
     ["Edit the venue, change the period's end to 09:00; Save Venue; read the booking", "Edit the venue, change the end back to 20:00; Save Venue; read the booking",
      "Edit the venue, Remove the period; Save Venue; read the booking"],
     f"{STAFF_DATA}\nEnd 20:00 -> 09:00 -> 20:00, then removed",
     "Ending at 09:00 (before the booking's 09:30 setup) clears the flag. Back to 20:00 flags it again ('1 booking flagged to coordinators.'). "
     "Removing the period clears the flag. The booking stays approved throughout.")
