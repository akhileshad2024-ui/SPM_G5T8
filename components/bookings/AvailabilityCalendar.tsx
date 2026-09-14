"use client";

import type { CSSProperties } from "react";
import { VENUES } from "@/lib/data";
import { useApp } from "@/lib/app-context";
import styles from "./AvailabilityCalendar.module.css";

const DAYS: Array<[number, string]> = [
  [2, "Mon 9"],
  [3, "Tue 10"],
  [4, "Wed 11"],
  [5, "Thu 12"],
  [6, "Fri 13"],
];

/** Weekly grid of which venue is booked (or overlapping) on which day. */
export function AvailabilityCalendar() {
  const app = useApp();
  const { events } = app.state;

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
            Conflict
          </span>
        </div>
      </div>

      <div className={styles.body}>
        <div className={styles.grid}>
          <div className={styles.headerRow}>
            <div />
            {DAYS.map(([d, label]) => (
              <div key={d}>{label}</div>
            ))}
          </div>

          {VENUES.map((v) => (
            <div key={v.id} className={styles.row}>
              <div className={styles.venueCell}>
                <div className={styles.venueName}>{v.name}</div>
                <div className={styles.venueMeta}>cap {v.cap}</div>
              </div>
              {DAYS.map(([d]) => {
                const hit = events.filter((e) => e.venue === v.id && e.day === d && e.bookingState);
                let label = "";
                let style: CSSProperties = { background: "#FAFAFB", border: "1px solid rgba(10,14,26,.07)" };

                if (hit.length > 1) {
                  label = `${hit.length} requests overlap`;
                  style = { background: "#FFF1F2", border: "1px solid #FF4D5E", color: "#8A0F1A" };
                } else if (hit.length === 1) {
                  const h = hit[0];
                  label = h.name;
                  style =
                    h.bookingState === "pending"
                      ? { background: "#E7EEFF", border: "1px solid #1466FF", color: "#0A33FF" }
                      : { background: "#0A0E1A", color: "#fff" };
                } else if (v.id === "V1" && d === 6) {
                  label = "Maintenance";
                  style = { background: "#EFF0F5", border: "1px dashed #A1A8BD", color: "#6B7388" };
                }

                return (
                  <div key={d} className={styles.cell} style={style}>
                    {label}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
