"use client";

import { useApp } from "@/lib/state/app-context";
import { BoardColumn } from "@/components/board/BoardColumn";

const COLUMNS: Array<[string, string, string]> = [
  ["submitted", "Submitted", "#1466FF"],
  ["under_review", "Under review", "#FFBF00"],
  ["approved", "Approved", "#00C2A8"],
  ["safety", "Safety check", "#FF7A00"],
  ["confirmed", "Confirmed", "#0A0E1A"],
];

// US44: every event in the Operational Safety Check, whichever step it is at.
const SAFETY_STATUSES = ["pending_safety_review", "safety_changes_requested", "safety_approved", "safety_rejected"];

export default function BoardPage() {
  const app = useApp();
  const { events } = app.state;

  return (
    <div style={{ padding: "24px 26px 34px" }}>
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start", overflowX: "auto", paddingBottom: 8 }}>
        {COLUMNS.map(([key, label, color]) => {
          const cards = events.filter((e) =>
            key === "under_review"
                ? e.status === "under_review" || e.status === "pending_clarification"
                : key === "safety"
                  ? SAFETY_STATUSES.includes(e.status)
                  : e.status === key
          );
          return <BoardColumn key={key} label={label} color={color} cards={cards} />;
        })}
      </div>
    </div>
  );
}
