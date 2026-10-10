"use client";

import { useApp } from "@/lib/app-context";
import { MyEventsTable } from "@/components/my-events/MyEventsTable";

export default function MyEventsPage() {
  const app = useApp();
  const mine = app.state.events.filter((e) => e.organiser === app.me.person);

  const stats: Array<[string, string]> = [
    [String(mine.filter((x) => x.status === "draft").length), "Drafts"],
    [String(mine.filter((x) => x.status === "submitted" || x.status === "under_review" || x.status === "pending_clarification").length), "Awaiting decision"],
    [String(mine.filter((x) => x.status === "planning" || x.status === "approved").length), "In planning"],
    [String(mine.filter((x) => x.status === "confirmed").length), "Confirmed"],
  ];

  return (
    <div style={{ padding: "24px 26px 34px", display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
        {stats.map(([n, label]) => (
          <div key={label} className="card" style={{ padding: "16px 18px" }}>
            <div className="display-number" style={{ fontSize: 38 }}>
              {n}
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>{label}</div>
          </div>
        ))}
      </div>

      <MyEventsTable events={mine} />
    </div>
  );
}
