"use client";

import { useApp } from "@/lib/app-context";
import { EQUIP } from "@/lib/data";
import { Tag } from "@/components/ui/Pill";
import type { EventRecord } from "@/lib/types";

export function EquipmentTab({ event }: { event: EventRecord }) {
  const app = useApp();

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "2fr .8fr 1fr 1.2fr",
          gap: 14,
          padding: "11px 20px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg)",
        }}
        className="eyebrow"
      >
        <div>Item</div>
        <div>Qty</div>
        <div>Available</div>
        <div>State</div>
      </div>

      {event.equip.map((it) => {
        const free = app.freeQty(it.id, event.id);
        const total = EQUIP.find((x) => x.id === it.id)?.total ?? 0;
        const catalogueItem = app.equipName(it.id);
        const ok = free >= it.qty;
        const state = event.equipState === "reserved" ? "Reserved" : ok ? "Available" : "Short";
        const pill =
          event.equipState === "reserved"
            ? { bg: "var(--ok-bg)", fg: "var(--ok-fg)" }
            : ok
              ? { bg: "var(--neutral-bg)", fg: "var(--neutral-fg)" }
              : { bg: "var(--bad-bg)", fg: "var(--bad-fg)" };

        return (
          <div
            key={it.id}
            style={{
              display: "grid",
              gridTemplateColumns: "2fr .8fr 1fr 1.2fr",
              gap: 14,
              padding: "13px 20px",
              borderBottom: "1px solid rgba(10,14,26,.06)",
              alignItems: "center",
              fontSize: 13.5,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <div style={{ fontWeight: 700 }}>{catalogueItem}</div>
            <div>{it.qty}</div>
            <div style={{ color: ok ? "var(--ok-fg)" : "var(--bad-fg)", fontWeight: 700 }}>
              {free} of {total}
            </div>
            <div>
              <Tag label={state} bg={pill.bg} fg={pill.fg} />
            </div>
          </div>
        );
      })}

      {event.equip.length === 0 && (
        <div className="empty-state" style={{ padding: "34px 20px" }}>
          No equipment recorded for this event.
        </div>
      )}
    </div>
  );
}
