"use client";

import { useApp } from "@/lib/state/app-context";
import { attendanceLabel } from "@/lib/events/details";
import { Dot } from "@/components/ui/Dot";
import { Tag } from "@/components/ui/Pill";
import type { EventRecord } from "@/lib/types";
import styles from "./BoardColumn.module.css";

export function BoardColumn({ label, color, cards }: { label: string; color: string; cards: EventRecord[] }) {
  const app = useApp();

  return (
    <div className={styles.column}>
      <div className={styles.columnHead}>
        <Dot color={color} />
        <span className={styles.columnLabel}>{label}</span>
        <span className={styles.columnCount}>{cards.length}</span>
      </div>

      {cards.map((e) => (
        <button key={e.id} className={styles.card} onClick={() => app.selectAndGoToQueue(e.id)}>
          <div className={styles.cardName}>{e.name}</div>
          <div className={styles.cardMeta}>
            {attendanceLabel(e.pax, "pax")} · {e.date}
          </div>
          <div className={styles.cardChips}>
            <Tag
              label={e.bookingState === "approved" ? "venue booked" : e.bookingState === "pending" ? "venue pending" : "no venue"}
              bg={e.bookingState === "approved" ? "var(--ok-bg)" : e.bookingState === "pending" ? "var(--warn-bg)" : "var(--neutral-bg)"}
              fg={e.bookingState === "approved" ? "var(--ok-fg)" : e.bookingState === "pending" ? "var(--warn-fg)" : "var(--text-faint)"}
            />
            <Tag
              label={e.equipState === "reserved" ? "equipment reserved" : e.equipState === "requested" ? "equipment pending" : "no equipment"}
              bg={e.equipState === "reserved" ? "var(--ok-bg)" : e.equipState === "requested" ? "var(--warn-bg)" : "var(--neutral-bg)"}
              fg={e.equipState === "reserved" ? "var(--ok-fg)" : e.equipState === "requested" ? "var(--warn-fg)" : "var(--text-faint)"}
            />
            {e.reg && <Tag label={`${e.registered}/${e.regCap} registered`} bg="var(--info-bg)" fg="var(--info-fg)" />}
          </div>
        </button>
      ))}

      {cards.length === 0 && <div className={styles.empty}>Empty</div>}
    </div>
  );
}
