"use client";

import type { CSSProperties } from "react";
import { useApp } from "@/lib/state/app-context";
import type { EventRecord, Venue } from "@/lib/types";
import {
  UNAVAILABILITY_REASONS,
  holdsBooking,
  occupiedWindow,
  overlaps,
  parseDateTime,
  parseEventDate,
} from "@/lib/venues/rules";
import styles from "./AvailabilityCalendar.module.css";

const DAYS: Array<[string, string]> = [
  ["09 Mar 2026", "Mon 9"],
  ["10 Mar 2026", "Tue 10"],
  ["11 Mar 2026", "Wed 11"],
  ["12 Mar 2026", "Thu 12"],
  ["13 Mar 2026", "Fri 13"],
];
const DAY_MINUTES = 24 * 60;

/** True when any two of these bookings need the venue at the same time, setup and turnaround included. */
function hasClash(bookings: EventRecord[], venue: Venue): boolean {
  const windows = bookings.map((e) => occupiedWindow(e, venue));
  return windows.some((a, i) => a && windows.slice(i + 1).some((b) => b && overlaps(a, b)));
}

/** Weekly grid of which venue is booked, clashing or unavailable on which day. */
export function AvailabilityCalendar() {
  const app = useApp();
  const { events } = app.state;
  const venues = app.state.venues.filter((v) => v.isActive);

  return (
    <div className={`card ${styles.card}`}>
      <div className={styles.head}>
        <div className={styles.headTitle}>Venue availability · week of 09 Mar 2026</div>
        <div className={styles.legend}>
          <span className={styles.legendItem}>
            <span className={styles.legendSwatch} style={{ background: "#0A0E1A" }} />
            Confirmed
          </span>
          <span className={styles.legendItem}>
            <span className={styles.legendSwatch} style={{ background: "#E7EEFF", border: "1px solid #1466FF" }} />
            Pending
          </span>
          <span className={styles.legendItem}>
            <span className={styles.legendSwatch} style={{ background: "#FFE8EA", border: "1px solid #FF4D5E" }} />
            Conflict (incl. setup &amp; turnaround)
          </span>
          <span className={styles.legendItem}>
            <span className={styles.legendSwatch} style={{ background: "#EFF0F5", border: "1px dashed #A1A8BD" }} />
            Unavailable
          </span>
        </div>
      </div>

      <div className={styles.body}>
        <div className={styles.grid}>
          <div className={styles.headerRow}>
            <div />
            {DAYS.map(([date, label]) => (
              <div key={date}>{label}</div>
            ))}
          </div>

          {venues.map((v) => (
            <div key={v.id} className={styles.row}>
              <div className={styles.venueCell}>
                <div className={styles.venueName}>{v.name}</div>
                <div className={styles.venueMeta}>
                  cap {v.cap} · +{v.setupMinutes}/{v.turnaroundMinutes} min
                </div>
              </div>
              {DAYS.map(([date]) => {
                const day = parseEventDate(date)!;
                const dayWindow = { start: day * DAY_MINUTES, end: (day + 1) * DAY_MINUTES };
                const hit = events.filter((e) => e.venue === v.id && holdsBooking(e) && parseEventDate(e.date) === day);
                const blocked = v.unavailability.find((p) => {
                  const start = parseDateTime(p.start);
                  const end = parseDateTime(p.end);
                  return start != null && end != null && overlaps({ start, end }, dayWindow);
                });
                let label = "";
                let style: CSSProperties = { background: "#FAFAFB", border: "1px solid rgba(10,14,26,.07)" };

                if (hit.length > 1 && hasClash(hit, v)) {
                  label = `${hit.length} bookings clash`;
                  style = { background: "#FFF1F2", border: "1px solid #FF4D5E", color: "#8A0F1A" };
                } else if (hit.length > 0 && blocked) {
                  label = `${hit.map((h) => h.name).join(", ")} · venue unavailable`;
                  style = { background: "#FFF1F2", border: "1px solid #FF4D5E", color: "#8A0F1A" };
                } else if (hit.length > 0) {
                  label = hit.map((h) => h.name).join(" · ");
                  style = hit.every((h) => h.bookingState === "approved")
                    ? { background: "#0A0E1A", color: "#fff" }
                    : { background: "#E7EEFF", border: "1px solid #1466FF", color: "#0A33FF" };
                } else if (blocked) {
                  label = UNAVAILABILITY_REASONS[blocked.reason] ?? "Unavailable";
                  style = { background: "#EFF0F5", border: "1px dashed #A1A8BD", color: "#6B7388" };
                }

                return (
                  <div key={date} className={styles.cell} style={style} title={label}>
                    {label}
                  </div>
                );
              })}
            </div>
          ))}
          {venues.length === 0 && <div style={{ padding: 16, fontSize: 12, color: "var(--text-subtle)" }}>No active venues in the catalogue.</div>}
        </div>
      </div>
    </div>
  );
}
