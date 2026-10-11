/**
 * US13: an event's status history as GET /events/{id}/history returns it, and how it is
 * worded on screen. Pure helpers (no React) apart from the fetch wrapper.
 */
import { apiFetch } from "../api/client";
import { STATUS } from "../data/options";
import type { EventStatus } from "../types";

/** One entry, oldest first (backend/schemas.py StatusChangeResponse). */
export interface StatusChange {
  fromStatus: EventStatus | null;
  toStatus: EventStatus;
  changedBy: string;
  changedAt: string;
  reason: string | null;
}

/** "Under Review": the name from US13's defined status set. */
export function statusLabel(status: EventStatus): string {
  return STATUS[status]?.label ?? status;
}

/** "Created as Draft" for the first entry, otherwise "Submitted → Under Review". */
export function describeChange(change: StatusChange): string {
  return change.fromStatus === null
    ? `Created as ${statusLabel(change.toStatus)}`
    : `${statusLabel(change.fromStatus)} → ${statusLabel(change.toStatus)}`;
}

/** "08 Oct 2026, 14:05" in the viewer's own time zone. */
export function formatChangedAt(iso: string, timeZone?: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  });
}

/** Newest first, the order the timeline shows. */
export function newestFirst(history: StatusChange[]): StatusChange[] {
  return [...history].reverse();
}

export function fetchStatusHistory(backendId: number): Promise<StatusChange[]> {
  return apiFetch<StatusChange[]>(`/events/${backendId}/history`);
}
