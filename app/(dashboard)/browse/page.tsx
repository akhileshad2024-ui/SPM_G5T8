"use client";

import { useApp } from "@/lib/app-context";
import { publishedEvents } from "@/lib/event-visibility";
import { PublicEventCard } from "@/components/browse/PublicEventCard";

export default function BrowsePage() {
  const app = useApp();
  const open = publishedEvents(app.state.events);

  return (
    <div style={{ padding: "24px 26px 40px", display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))", gap: 14 }}>
        {open.map((e) => (
          <PublicEventCard key={e.id} event={e} />
        ))}
      </div>
    </div>
  );
}
