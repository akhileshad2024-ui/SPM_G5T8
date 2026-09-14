"use client";

import { useApp } from "@/lib/app-context";
import { StatusPill } from "@/components/ui/Pill";
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

  const actions: Array<{ label: string; onClick: () => void; variant: "primary" | "ghost" | "danger" | "muted" }> = [];
  if (event.status === "submitted" || event.status === "under_review") {
    actions.push({ label: "Request clarification", onClick: () => app.openModal("clarify", event.id), variant: "ghost" });
    actions.push({ label: "Reject", onClick: () => app.openModal("reject", event.id), variant: "danger" });
    actions.push({ label: "Approve", onClick: () => app.approve(event.id), variant: "primary" });
  } else if (event.bookingState === "pending") {
    actions.push({ label: "Awaiting venue decision", onClick: () => app.flash("Venue Staff have this booking request.", "warn"), variant: "muted" });
  } else if (!event.venue) {
    actions.push({ label: "Find a venue", onClick: () => app.setTab("venue"), variant: "primary" });
  } else if (event.equipState === "requested") {
    actions.push({ label: "Equipment pending with Technical Support", onClick: () => app.setTab("equipment"), variant: "muted" });
  } else if (event.status === "planning") {
    actions.push({ label: "Confirm event", onClick: () => app.confirmEvent(event.id), variant: "primary" });
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
            {event.id} · {event.organiser} · {event.date}, {event.start}–{event.end} · {event.pax} expected
          </div>
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
