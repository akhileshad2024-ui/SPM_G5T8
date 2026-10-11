import { StatusHistory } from "@/components/ui/StatusHistory";
import type { EventRecord } from "@/lib/types";

export function ActivityTab({ event }: { event: EventRecord }) {
  return (
    <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div className="card" style={{ flex: "0 1 300px", minWidth: 260, padding: "20px 22px" }}>
        <div className="section-heading" style={{ marginBottom: 12 }}>
          Status history
        </div>
        <StatusHistory event={event} />
      </div>
      <div className="card" style={{ flex: 1, minWidth: 320, padding: "20px 22px" }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          {event.activity.map((a, i) => (
            <div key={i} style={{ display: "flex", gap: 14 }}>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 12, flex: "none" }}>
                <span
                  className="dot"
                  style={{ width: 9, height: 9, background: i === 0 ? "var(--blue)" : "#C9CEDD", marginTop: 5 }}
                />
                <span
                  style={{
                    width: 1,
                    flex: 1,
                    background: i === event.activity.length - 1 ? "transparent" : "rgba(10,14,26,.12)",
                  }}
                />
              </div>
              <div style={{ paddingBottom: 18, flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13.5, fontWeight: 700 }}>{a.title}</span>
                  <span className="tabular" style={{ fontSize: 11, color: "var(--text-subtle)" }}>
                    {a.when}
                  </span>
                </div>
                <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.55, marginTop: 3 }}>{a.body}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
