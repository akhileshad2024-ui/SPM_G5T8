"use client";

import { useApp } from "@/lib/state/app-context";
import { attendanceLabel } from "@/lib/events/details";
import { StatusPill } from "@/components/ui/Pill";
import { hasFlaggedBooking } from "@/lib/venues/replacement";
import type { EventRecord } from "@/lib/types";
import styles from "./QueueList.module.css";

const FILTERS: Array<[string, string]> = [
  ["action", "Needs action"],
  ["unassigned", "Unassigned"],
  ["mine", "Mine"],
  ["replacement", "Needs a venue"],
  ["all", "All"],
];

export function QueueList({ events, selectedId }: { events: EventRecord[]; selectedId: string }) {
  const app = useApp();
  const { search, queueFilter } = app.state;
  // US40: how many events have a booking that needs a replacement venue.
  const needVenue = app.state.events.filter(hasFlaggedBooking).length;

  return (
    <div className={styles.panel}>
      <div className={styles.controls}>
        <input
          className={styles.search}
          value={search}
          onChange={(e) => app.setSearch(e.target.value)}
          placeholder="Search events, organisers or IDs"
        />
        <div className={styles.filters}>
          {FILTERS.map(([id, label]) => (
            <button
              key={id}
              className={`${styles.filter} ${queueFilter === id ? styles.filterActive : ""}`}
              onClick={() => app.setQueueFilter(id as typeof queueFilter)}
            >
              {label}
              {id === "replacement" && needVenue > 0 ? ` (${needVenue})` : ""}
            </button>
          ))}
        </div>
      </div>
      <div className={styles.list}>
        {events.map((e) => (
          <button
            key={e.id}
            className={`${styles.row} ${e.id === selectedId ? styles.rowActive : ""}`}
            onClick={() => app.select(e.id)}
          >
            <div className={styles.rowTop}>
              <span className={styles.rowName}>{e.name}</span>
              <StatusPill status={e.status} />
            </div>
            <div className={styles.rowMeta}>
              {e.organiser} · {attendanceLabel(e.pax, "pax")} · {e.date}
            </div>
            <div className={styles.rowMeta}>{e.coordinator ? `Coordinator: ${e.coordinator}` : "Unassigned"}</div>
            <div className={styles.rowAge}>{e.submittedAgo}</div>
          </button>
        ))}
        {events.length === 0 && <div className="empty-state">No events match this filter.</div>}
      </div>
    </div>
  );
}
