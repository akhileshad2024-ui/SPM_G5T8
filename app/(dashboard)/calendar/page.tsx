"use client";

import { AvailabilityCalendar } from "@/components/bookings/AvailabilityCalendar";

/** US19: the venue availability calendar for internal staff. Venue Staff see it on Booking requests. */
export default function CalendarPage() {
  return (
    <div style={{ padding: "24px 26px 34px" }}>
      <AvailabilityCalendar />
    </div>
  );
}
