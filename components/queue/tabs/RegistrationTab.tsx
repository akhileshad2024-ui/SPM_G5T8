import { ProgressBar } from "@/components/ui/ProgressBar";
import { Tag } from "@/components/ui/Pill";
import type { EventRecord } from "@/lib/types";

// This is illustrative sample data in the original prototype too — there is
// no per-attendee registration backend, only the aggregate count on the event.
const SAMPLE_REGISTRATIONS = [
  { name: "Sam Adeyemi", when: "2 days ago", state: "Confirmed" },
  { name: "Nadia Haq", when: "3 days ago", state: "Confirmed" },
  { name: "Oliver Boyd", when: "4 days ago", state: "Withdrawn" },
];

export function RegistrationTab({ event }: { event: EventRecord }) {
  const pct = event.reg && event.regCap ? Math.min(100, Math.round((event.registered / event.regCap) * 100)) : 0;

  return (
    <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
      <div className="card" style={{ padding: "20px 22px", minWidth: 260 }}>
        <div className="eyebrow">Registered</div>
        <div className="display-number" style={{ fontSize: 58, marginTop: 6 }}>
          {event.registered}
        </div>
        <div className="tabular" style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {event.reg ? `of ${event.regCap} places` : "registration disabled"}
        </div>
        <div style={{ marginTop: 16 }}>
          <ProgressBar pct={pct} />
        </div>
      </div>

      <div className="card" style={{ flex: 1, minWidth: 280, overflow: "hidden" }}>
        <div style={{ padding: "13px 20px", borderBottom: "1px solid var(--border)", fontWeight: 700, fontSize: 13 }}>
          Registrations
        </div>
        {event.reg ? (
          SAMPLE_REGISTRATIONS.map((rg) => (
            <div
              key={rg.name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "12px 20px",
                borderBottom: "1px solid rgba(10,14,26,.06)",
              }}
            >
              <span style={{ fontSize: 13.5, fontWeight: 700, flex: 1 }}>{rg.name}</span>
              <span className="tabular" style={{ fontSize: 12, color: "var(--text-faint)" }}>
                {rg.when}
              </span>
              <Tag
                label={rg.state}
                bg={rg.state === "Confirmed" ? "var(--ok-bg)" : "var(--neutral-bg)"}
                fg={rg.state === "Confirmed" ? "var(--ok-fg)" : "var(--neutral-fg)"}
              />
            </div>
          ))
        ) : (
          <div className="empty-state" style={{ padding: "34px 20px" }}>
            Registration is not enabled for this event.
          </div>
        )}
      </div>
    </div>
  );
}
