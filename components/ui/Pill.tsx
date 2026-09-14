import { STATUS } from "@/lib/data";
import type { EventStatus } from "@/lib/types";

/** The big uppercase status pill (Draft, Submitted, Confirmed, ...). */
export function StatusPill({ status }: { status: EventStatus }) {
  const s = STATUS[status] ?? STATUS.draft;
  return (
    <span className="pill" style={{ background: s.bg, color: s.fg }}>
      {s.label}
    </span>
  );
}

/** A small rounded tag/chip used for facilities, layouts, and inline flags. */
export function Tag({
  label,
  bg = "#F4F5F9",
  fg = "#4A5169",
  border,
}: {
  label: string;
  bg?: string;
  fg?: string;
  border?: string;
}) {
  return (
    <span
      className="pill-sm"
      style={{ background: bg, color: fg, border: border ? `1px solid ${border}` : undefined }}
    >
      {label}
    </span>
  );
}
