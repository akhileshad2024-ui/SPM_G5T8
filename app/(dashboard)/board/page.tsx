"use client";

import { useApp } from "@/lib/state/app-context";
import { BoardColumn } from "@/components/board/BoardColumn";

const COLUMNS: Array<[string, string, string]> = [
  ["submitted", "Submitted", "#1466FF"],
  ["under_review", "Under review", "#FFBF00"],
  ["approved", "Approved", "#00C2A8"],
  ["confirmed", "Confirmed", "#0A0E1A"],
];

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
                : e.status === key
          );
          return <BoardColumn key={key} label={label} color={color} cards={cards} />;
        })}
      </div>
    </div>
  );
}
