"use client";

import { useApp } from "@/lib/app-context";
import { VENUES } from "@/lib/data";
import { VenueCard } from "@/components/catalogue/VenueCard";

export default function CataloguePage() {
  const app = useApp();
  const { events } = app.state;

  return (
    <div style={{ padding: "24px 26px 34px", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(288px, 1fr))", gap: 14 }}>
      {VENUES.map((v) => (
        <VenueCard
          key={v.id}
          venue={v}
          booked={events.filter((e) => e.venue === v.id && e.bookingState === "approved").length}
        />
      ))}
    </div>
  );
}
