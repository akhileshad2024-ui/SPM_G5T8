"use client";

import { useApp } from "@/lib/app-context";
import { Dot } from "@/components/ui/Dot";
import type { EventRecord } from "@/lib/types";
import styles from "./RequestTab.module.css";

const OK = "#00C2A8";
const WARN = "#FFBF00";
const OFF = "#C9CEDD";
const OK_TEXT = "#006B60";
const WARN_TEXT = "#7A5C00";
const OFF_TEXT = "#A1A8BD";

function readyDot(ok: boolean | "pending") {
  return ok === true ? OK : ok === "pending" ? WARN : OFF;
}
function readyColor(tone: "ok" | "warn" | "off") {
  return tone === "ok" ? OK_TEXT : tone === "warn" ? WARN_TEXT : OFF_TEXT;
}

export function RequestTab({ event }: { event: EventRecord }) {
  const app = useApp();
  const me = app.me;
  const venue = event.venue ? app.venue(event.venue) : undefined;

  const fields: Array<[string, string]> = [
    ["Proposed date", event.date],
    ["Time", `${event.start} – ${event.end}`],
    ["Expected attendance", String(event.pax)],
    ["Required layout", event.layout ? event.layout.charAt(0).toUpperCase() + event.layout.slice(1) : "Any"],
    ["Facilities", event.facilities.join(", ") || "None specified"],
    ["Accessibility", event.access.join(", ") || "None specified"],
    ["Equipment", event.equip.map((it) => `${it.qty} × ${app.equipName(it.id)}`).join(", ") || "None requested"],
    ["Registration", event.reg ? `Enabled · cap ${event.regCap}` : "Not enabled"],
  ];

  const readiness: Array<{ label: string; ok: boolean | "pending"; value: string; tone: "ok" | "warn" | "off" }> = [
    { label: "Coordinator", ok: !!event.coordinator, value: event.coordinator ? "Assigned" : "Not yet", tone: event.coordinator ? "ok" : "off" },
    {
      label: "Venue",
      ok: event.bookingState === "approved" ? true : event.bookingState === "pending" ? "pending" : false,
      value: event.bookingState === "approved" ? venue?.name ?? "" : event.bookingState === "pending" ? "Pending" : "Not booked",
      tone: event.bookingState === "approved" ? "ok" : event.bookingState === "pending" ? "warn" : "off",
    },
    {
      label: "Equipment",
      ok: event.equipState === "reserved" ? true : event.equipState === "requested" ? "pending" : false,
      value: event.equipState === "reserved" ? "Reserved" : event.equipState === "requested" ? "Requested" : "None",
      tone: event.equipState === "reserved" ? "ok" : event.equipState === "requested" ? "warn" : "off",
    },
    {
      label: "Registration",
      ok: event.reg,
      value: event.reg ? `${event.registered} / ${event.regCap}` : "Disabled",
      tone: event.reg ? "ok" : "off",
    },
  ];

  const assignLabel = event.coordinator === me.person ? "Reassign" : event.coordinator ? "Take over as coordinator" : "Assign to me";

  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        <div className={`card ${styles.card}`}>
          <div className="eyebrow">Purpose</div>
          <div className={styles.purpose}>{event.purpose}</div>
          <div className={styles.divider} />
          <div className={styles.fieldGrid}>
            {fields.map(([k, v]) => (
              <div key={k}>
                <div className={styles.fieldLabel}>{k}</div>
                <div className={styles.fieldValue}>{v}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className={styles.side}>
        <div className={`card ${styles.sideCard}`}>
          <div className={`eyebrow ${styles.sideHeading}`}>Coordinator</div>
          <div className={styles.coordinatorName}>{event.coordinator || "Unassigned"}</div>
          <button className={`btn btn-ghost ${styles.assignButton}`} onClick={() => app.assignSelf(event.id)}>
            {assignLabel}
          </button>
        </div>
        <div className={`card ${styles.sideCard}`}>
          <div className={`eyebrow ${styles.sideHeading}`}>Readiness</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
            {readiness.map((r) => (
              <div key={r.label} className={styles.readinessRow}>
                <Dot color={readyDot(r.ok)} />
                <span className={styles.readinessLabel}>{r.label}</span>
                <span className={styles.readinessValue} style={{ color: readyColor(r.tone) }}>
                  {r.value}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
