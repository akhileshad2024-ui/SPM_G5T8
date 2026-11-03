"use client";

import { useApp } from "@/lib/state/app-context";
import { useRef, useState } from "react";
import { attendanceLabel, lastUpdatedLabel } from "@/lib/events/details";
import { StatusPill } from "@/components/ui/Pill";
import { hasFlaggedBooking } from "@/lib/venues/replacement";
import type { EventRecord, EventTab } from "@/lib/types";
import { RequestTab } from "./tabs/RequestTab";
import { VenueTab } from "./tabs/VenueTab";
import { EquipmentTab } from "./tabs/EquipmentTab";
import { RegistrationTab } from "./tabs/RegistrationTab";
import { ActivityTab } from "./tabs/ActivityTab";
import styles from "./EventWorkspace.module.css";

const TABS: Array<[EventTab, string]> = [
  ["request", "Request"],
  ["venue", "Venue"],
  ["equipment", "Equipment"],
  ["registration", "Registration"],
  ["activity", "Activity"],
];

export function EventWorkspace({ event }: { event: EventRecord }) {
  const app = useApp();
  const tab = app.state.tab;
  const resumePending = useRef(false);
  const [resuming, setResuming] = useState(false);
  async function resume() {
    if (resumePending.current || event.backendId === undefined) return;
    resumePending.current = true;
    setResuming(true);
    try { await app.resumeReview(event.backendId); }
    finally { resumePending.current = false; setResuming(false); }
  }

  const actions: Array<{ label: string; onClick: () => void; variant: "primary" | "ghost" | "danger" | "muted" }> = [];
  if (event.status === "submitted") {
    actions.push({ label: "Start review", onClick: () => app.startReview(event.id), variant: "primary" });
  } else if (event.status === "under_review") {
    actions.push({ label: "Request clarification", onClick: () => app.openModal("clarify", event.id), variant: "ghost" });
    actions.push({ label: "Request amendment", onClick: () => app.openModal("amend", event.id), variant: "ghost" });
    actions.push({ label: "Reject", onClick: () => app.openModal("reject", event.id), variant: "danger" });
    actions.push({ label: "Approve", onClick: () => app.openModal("approve", event.id), variant: "primary" });
  } else if (event.status === "pending_clarification") {
    if (event.clarification?.response && event.backendId !== undefined) {
      actions.push({ label: resuming ? "Resuming…" : "Resume review", onClick: () => void resume(), variant: "primary" });
    } else {
      actions.push({ label: "Awaiting organiser reply", onClick: () => app.flash(`Waiting for ${event.organiser} to respond.`, "warn"), variant: "muted" });
    }
  } else if (event.status === "rejected" || event.status === "cancelled") {
    // Closed: nothing left for the coordinator to do.
  } else if (event.status === "pending_safety_review") {
    // US44: the venue and equipment are confirmed; a Safety Officer is reviewing them.
    actions.push({ label: "Awaiting safety check", onClick: () => app.flash("A Safety Officer is reviewing this event's arrangements.", "warn"), variant: "muted" });
  } else if (event.status === "safety_changes_requested" || event.status === "safety_rejected") {
    // US44: back to rework (US45) and then to the safety check again. Not closed: the event carries on.
    if (event.backendId !== undefined) {
      const id = event.backendId;
      actions.push({ label: "Request safety check again", onClick: () => void app.requestSafetyCheck(id), variant: "primary" });
    }
  } else if (event.status === "safety_approved") {
    // US44: safe to go on; confirming is US14, which isn't built yet.
    actions.push({ label: "Safety approved: ready to confirm (not available yet)", onClick: () => app.flash("Confirming events isn't available yet.", "warn"), variant: "muted" });
  } else if (event.bookingState === "pending") {
    actions.push({ label: "Awaiting venue decision", onClick: () => app.flash("Venue Staff have this booking request.", "warn"), variant: "muted" });
  } else if (!event.venue) {
    actions.push({ label: "Find a venue", onClick: () => app.setTab("venue"), variant: "primary" });
  } else if (event.equipState === "requested") {
    actions.push({ label: "Equipment pending with Technical Support", onClick: () => app.setTab("equipment"), variant: "muted" });
  } else if (event.status === "approved" && event.bookingState === "approved") {
    // Approved with the venue booked and equipment settled: next is the Operational Safety Check (US44), then
    // confirming (US14, not built yet). Sample events that were never stored keep the old one-step confirm.
    if (event.backendId === undefined) {
      actions.push({ label: "Confirm event", onClick: () => app.confirmEvent(event.id), variant: "primary" });
    } else {
      const id = event.backendId;
      actions.push({ label: "Request safety check", onClick: () => void app.requestSafetyCheck(id), variant: "primary" });
    }
  }

  // US40: a booking whose venue became unavailable needs a replacement; the Venue tab searches for one.
  if (hasFlaggedBooking(event) && event.status !== "rejected" && event.status !== "cancelled") {
    actions.unshift({ label: "Find a replacement venue", onClick: () => app.setTab("venue"), variant: "danger" });
  }

  const variantClass = { primary: "btn-primary", ghost: "btn-ghost", danger: "btn-danger", muted: "btn-muted" } as const;

  return (
    <div className={styles.workspace}>
      <div className={styles.header}>
        <div className={styles.headerMain}>
          <div className={styles.headerTop}>
            <span className={styles.name}>{event.name}</span>
            <StatusPill status={event.status} />
          </div>
          <div className={styles.line}>
            {event.id} · {event.organiser} · {event.date}, {event.start}–{event.end} · {attendanceLabel(event.pax, "expected")}
          </div>
          {event.updatedAt && (
            <div className={`${styles.line} tabular`}>
              <time dateTime={event.updatedAt}>{lastUpdatedLabel({ updatedAt: event.updatedAt })}</time>
            </div>
          )}
        </div>
        <div className={styles.actions}>
          {actions.map((a) => (
            <button key={a.label} className={`btn ${variantClass[a.variant]}`} onClick={a.onClick}>
              {a.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.tabs}>
        {TABS.map(([id, label]) => (
          <button
            key={id}
            className={`${styles.tab} ${tab === id ? styles.tabActive : ""}`}
            onClick={() => app.setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className={styles.content}>
        {tab === "request" && <RequestTab event={event} />}
        {tab === "venue" && <VenueTab event={event} />}
        {tab === "equipment" && <EquipmentTab event={event} />}
        {tab === "registration" && <RegistrationTab event={event} />}
        {tab === "activity" && <ActivityTab event={event} />}
      </div>
    </div>
  );
}
