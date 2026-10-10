"use client";

import { useApp } from "@/lib/state/app-context";
import { publishedEvents } from "@/lib/events/visibility";
import { PublicEventCard } from "@/components/browse/PublicEventCard";
import { Tag } from "@/components/ui/Pill";

export default function BrowsePage() {
  const app = useApp();
  const open = publishedEvents(app.state.events);
  const mine = app.state.registrations.filter((r) => r.attendeeEmail === app.me.email);

  return (
    <div style={{ padding: "24px 26px 40px", display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))", gap: 14 }}>
        {open.map((e) => (
          <PublicEventCard key={e.id} event={e} />
        ))}
      </div>
      <section>
        <h2 style={{ fontSize: 18, margin: "8px 0 12px" }}>My registrations</h2>
        <div className="card" style={{ overflow: "hidden" }}>
          {mine.length === 0 ? <div className="empty-state">You have not registered for an event yet.</div> : mine.map((r) => {
            // The saved record carries the event's details, so cancelled events (no longer on Browse) still show.
            const event = app.event(r.eventId);
            return <div key={r.id} style={{ display: "flex", justifyContent: "space-between", gap: 16, padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
              <div><strong>{r.eventName ?? event?.name ?? r.eventId}</strong><div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{r.eventDate ?? event?.date} · {r.eventStart ?? event?.start}–{r.eventEnd ?? event?.end}</div></div>
              <Tag label={event?.status === "cancelled" ? "cancelled" : r.status} bg="var(--neutral-bg)" fg="var(--neutral-fg)" />
            </div>;
          })}
        </div>
      </section>
    </div>
  );
}
