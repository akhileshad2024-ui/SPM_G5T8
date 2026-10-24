import type { BookingConflict } from "@/lib/types";

/**
 * Everything in the way of a booking, each with the details of the other booking (US38, US46, US47, US48):
 * which event, when it runs and whether it is confirmed or still pending. An unavailable period is described
 * by its message alone.
 */
export function ConflictList({ conflicts }: { conflicts: BookingConflict[] }) {
  if (conflicts.length === 0) return null;
  return (
    <ul style={{ margin: "6px 0 0 16px", fontSize: 12.5 }}>
      {conflicts.map((c, n) => (
        <li key={`${c.kind}-${c.booking_id ?? c.period_start}-${n}`}>
          {c.message}
          {c.kind !== "unavailable_period" && (
            <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
              {c.event_name} · {c.date}, {c.start}–{c.end} · {c.status === "approved" ? "Confirmed" : "Pending"} booking
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
