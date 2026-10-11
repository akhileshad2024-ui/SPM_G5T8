"use client";

import { useApp } from "@/lib/state/app-context";
import { Dot } from "@/components/ui/Dot";
import { Tag } from "@/components/ui/Pill";
import { EventDetailsToggle } from "@/components/ui/EventDetails";
import { StatusHistoryToggle } from "@/components/ui/StatusHistory";
import type { EventRecord } from "@/lib/types";

export function EquipmentRequestCard({ event }: { event: EventRecord }) {
  const app = useApp();
  const venue = event.venue ? app.venue(event.venue) : undefined;
  const done = event.equipState === "reserved";
  const allOk = event.equip.every((it) => app.freeQty(it.id, event.id) >= it.qty);

  const reserveLabel = done ? "Release reservation" : allOk ? "Reserve equipment" : "Insufficient stock";
  const reserveVariant = done ? "btn-ghost" : allOk ? "btn-primary" : "btn-muted";
  const note = done ? "Held against this event only" : allOk ? "Reduces availability for overlapping events" : "Reduce quantities or free stock elsewhere";

  const onReserve = () => {
    if (done) {
      app.releaseEquipment(event.id);
      return;
    }
    app.reserveEquipment(event.id);
  };

  return (
    <div className="card" style={{ padding: "18px 20px" }}>
      <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 15.5, fontWeight: 700 }}>{event.name}</span>
            <Tag
              label={done ? "Reserved" : "Requested"}
              bg={done ? "var(--ok-bg)" : "var(--warn-bg)"}
              fg={done ? "var(--ok-fg)" : "var(--warn-fg)"}
            />
          </div>
          <div className="tabular" style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 6 }}>
            {event.date}, {event.start}–{event.end} · {venue?.name ?? event.venueName ?? "venue not booked"}
          </div>
          <div style={{ marginTop: 13, display: "flex", flexDirection: "column", gap: 7 }}>
            {event.equip.map((it) => {
              const free = app.freeQty(it.id, event.id);
              const ok = free >= it.qty;
              return (
                <div key={it.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                  <Dot color={ok ? "var(--ok-dot)" : "var(--bad-dot)"} size={7} />
                  <span style={{ fontWeight: 700, minWidth: 0 }}>{app.equipName(it.id)}</span>
                  <span className="tabular" style={{ color: "var(--text-faint)" }}>
                    × {it.qty}
                  </span>
                  <span style={{ flex: 1 }} />
                  <span className="tabular" style={{ fontSize: 12, fontWeight: 700, color: ok ? "var(--ok-fg)" : "var(--bad-fg)" }}>
                    {ok ? `${free} free` : `only ${free} free`}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
        <div style={{ width: 200, flex: "none", display: "flex", flexDirection: "column", gap: 8 }}>
          <button className={`btn ${reserveVariant}`} style={{ justifyContent: "center" }} onClick={onReserve}>
            {reserveLabel}
          </button>
          <div style={{ fontSize: 11, color: "var(--text-subtle)", lineHeight: 1.45, textAlign: "center" }}>{note}</div>
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <EventDetailsToggle event={event} />
        <StatusHistoryToggle event={event} />
      </div>
    </div>
  );
}
