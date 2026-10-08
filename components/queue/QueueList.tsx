"use client";

import { useApp } from "@/lib/state/app-context";
import { StatusPill } from "@/components/ui/Pill";
import type { EventRecord } from "@/lib/types";
import styles from "./QueueList.module.css";

const FILTERS: Array<[string, string]> = [
  ["action", "Needs action"],
  ["unassigned", "Unassigned"],
  ["mine", "Mine"],
  ["all", "All"],
];

export function QueueList({ events, selectedId }: { events: EventRecord[]; selectedId: string }) {
  const app = useApp();
  const { search, queueFilter } = app.state;

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
              {e.organiser} · {e.pax} pax · {e.date}
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
