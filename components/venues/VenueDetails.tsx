import type { ReactNode } from "react";
import { Tag } from "@/components/ui/Pill";
import type { Venue } from "@/lib/types";
import { UNAVAILABILITY_REASONS, formatDateTime, parseDateTime } from "@/lib/venues/rules";

const eyebrow = { fontSize: 10, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-faint)", marginBottom: 7 } as const;

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div style={eyebrow}>{title}</div>
      {children}
    </div>
  );
}

function Tags({ items, empty }: { items: string[]; empty: string }) {
  if (items.length === 0) return <div style={{ fontSize: 12, color: "var(--text-faint)" }}>{empty}</div>;
  return (
    <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
      {items.map((item) => (
        <Tag key={item} label={item} />
      ))}
    </div>
  );
}

/** Everything the catalogue holds about one venue, for reading only: no buttons, no inputs. */
export function VenueDetails({ venue }: { venue: Venue }) {
  return (
    <div className="card" style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }} aria-label={`Details of ${venue.name}`}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{venue.name}</div>
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 4 }}>
          <strong>Location:</strong> {venue.building}
        </div>
      </div>

      <div>
        <div className="display-number" style={{ fontSize: 30 }}>{venue.cap}</div>
        <div style={{ ...eyebrow, marginTop: 5, marginBottom: 0 }}>Capacity</div>
      </div>

      <div style={{ height: 1, background: "var(--border)" }} />

      <Block title="Supported layouts">
        <Tags items={venue.layouts.map((l) => l.charAt(0).toUpperCase() + l.slice(1))} empty="None recorded" />
      </Block>
      <Block title="Facilities">
        <Tags items={venue.facilities} empty="None recorded" />
      </Block>
      <Block title="Accessibility features">
        <Tags items={venue.accessibility} empty="None recorded" />
      </Block>

      <div style={{ height: 1, background: "var(--border)" }} />

      <div style={{ fontSize: 12.5, color: "var(--text-muted)", display: "flex", flexDirection: "column", gap: 3 }}>
        <div><strong>Hours:</strong> {venue.operatingHours ?? "Not recorded"}</div>
        <div><strong>Open on:</strong> {venue.operatingDays.length ? venue.operatingDays.join(", ") : "Not recorded"}</div>
        <div><strong>Setup:</strong> {venue.setupMinutes} min · <strong>Turnaround:</strong> {venue.turnaroundMinutes} min</div>
      </div>

      {venue.unavailability.length > 0 && (
        <Block title="Unavailable">
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {venue.unavailability.map((p, i) => {
              const start = parseDateTime(p.start);
              const end = parseDateTime(p.end);
              return (
                <div key={i} style={{ fontSize: 11, padding: "4px 8px", background: "#ffeaea", color: "var(--bad-dot)", borderRadius: 4 }}>
                  <strong>{UNAVAILABILITY_REASONS[p.reason] ?? p.reason}</strong>
                  {start != null && end != null && ` · ${formatDateTime(start)} – ${formatDateTime(end)}`}
                  {p.note && ` · ${p.note}`}
                </div>
              );
            })}
          </div>
        </Block>
      )}

      <div style={{ fontSize: 11, color: "var(--text-faint)" }}>
        Last updated by {venue.lastUpdatedBy} · {new Date(venue.lastUpdatedAt).toLocaleString("en-GB")}
      </div>
    </div>
  );
}
