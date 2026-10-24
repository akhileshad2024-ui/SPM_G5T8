"use client";

import { useState } from "react";
import { useApp } from "@/lib/state/app-context";
import { assignmentNote } from "@/lib/events/review/lead";
import { IN_REVIEW_STATUSES, requestDetails, reviewChecks } from "@/lib/events/review/review";
import { Dot } from "@/components/ui/Dot";
import { EventDetailsToggle } from "@/components/ui/EventDetails";
import { ClarificationThread } from "@/components/ui/ClarificationThread";
import { EventDetailsEditor } from "../EventDetailsEditor";
import type { EventRecord } from "@/lib/types";
import styles from "./RequestTab.module.css";

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** US11/US43: the event's coordinator and who assigned them. Only the Lead assigns (Assignments page). */
function CoordinatorCard({ event }: { event: EventRecord }) {
  const assigned = assignmentNote(event, formatTimestamp);
  return (
    <div className={`card ${styles.sideCard}`}>
      <div className={`eyebrow ${styles.sideHeading}`}>Coordinator</div>
      <div className={styles.coordinatorName}>{event.coordinator || "Unassigned"}</div>
      {assigned && <div className={styles.hint}>{assigned}</div>}
    </div>
  );
}

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
  const venue = event.venue ? app.venue(event.venue) : undefined;
  const fields = requestDetails(event, app.equipName);
  // Clarity checks only matter while the request is still being reviewed.
  const checks = IN_REVIEW_STATUSES.includes(event.status) ? reviewChecks(event, app.equipName) : [];
  const { clarification, decision } = event;

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

  return (
    <div className={styles.layout}>
      <div className={styles.main}>
        <EventDetailsEditor key={event.id} event={event} />
        {decision && (
          <div
            className={`card ${styles.card} ${decision.outcome === "approved" ? styles.decisionApproved : styles.decisionRejected}`}
          >
            <div className="eyebrow">{decision.outcome === "approved" ? "Approved" : "Rejected"}</div>
            <div className={styles.messageMeta} style={{ marginTop: 8 }}>
              {decision.by} · {formatTimestamp(decision.at)}
            </div>
            {decision.reason && <div className={styles.message}>{decision.reason}</div>}
          </div>
        )}

        {checks.length > 0 && (
          <div className={`card ${styles.card} ${styles.checks}`}>
            <div className="eyebrow">Worth clarifying</div>
            <ul className={styles.checkList}>
              {checks.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        )}

        {clarification && (
          <div className={`card ${styles.card}`}>
            <ClarificationThread event={event} />
            {event.status === "pending_clarification" && !clarification.response && (
              <div className={styles.hint}>Waiting for {event.organiser} to respond.</div>
            )}
          </div>
        )}

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
          {event.submittedAt && (
            <div className={styles.hint}>Submitted {formatTimestamp(event.submittedAt)}</div>
          )}
          <div style={{ marginTop: 12 }}>
            <EventDetailsToggle event={event} />
          </div>
        </div>
      </div>

      <div className={styles.side}>
        <CoordinatorCard key={`${event.id}:${event.coordinator}`} event={event} />
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
