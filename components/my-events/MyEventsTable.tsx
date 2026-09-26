"use client";

import { useApp } from "@/lib/app-context";
import { StatusPill } from "@/components/ui/Pill";
import { canDirectlyEditEventRequest } from "@/lib/event-request/submission";
import type { EventRecord } from "@/lib/types";
import styles from "./MyEventsTable.module.css";

export function MyEventsTable({ events }: { events: EventRecord[] }) {
  const app = useApp();

  return (
    <div className={`card ${styles.card}`}>
      <div className={styles.head}>
        <div className={styles.headTitle}>My event requests</div>
        <button className="btn btn-primary" onClick={() => app.beginNewRequest()}>
          New event request
        </button>
      </div>
      <div className={`${styles.columns} eyebrow`}>
        <div>Event</div>
        <div>Proposed</div>
        <div>Pax</div>
        <div>Status</div>
        <div style={{ textAlign: "right" }}>Action</div>
      </div>

      {events.map((e) => (
        <div key={e.id} className={styles.row}>
          <div style={{ minWidth: 0 }}>
            <div className={styles.eventName}>{e.name}</div>
            <div className={styles.eventId}>{e.id}</div>
          </div>
          <div className={styles.cell}>
            {e.date} · {e.start}
          </div>
          <div className={styles.cell}>{e.pax}</div>
          <div>
            <StatusPill status={e.status} />
          </div>
          <div className={styles.actionsCell}>
            {canDirectlyEditEventRequest(e.status) ? (
              <>
                <button className="btn btn-ghost btn-sm" onClick={() => app.beginNewRequest(e.id)}>
                  Continue
                </button>
                <button className="btn btn-primary btn-sm" onClick={() => app.submitDraft(e.id)}>
                  Submit
                </button>
              </>
            ) : e.status === "rejected" ? (
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => app.flash(e.activity[0]?.body || "No reason recorded.", "warn")}
              >
                View reason
              </button>
            ) : (
              <button className="btn btn-ghost btn-sm" onClick={() => app.openModal("change", e.id)}>
                Request change
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
