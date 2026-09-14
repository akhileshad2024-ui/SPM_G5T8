/**
 * Pure, framework-free helpers for deriving values from the event list.
 * Kept separate from `app-context.tsx` so they can be unit tested or
 * reused without pulling in React.
 */
import { EQUIP, VENUES } from "./data";
import type { EventRecord, Venue } from "./types";

export function getEvent(events: EventRecord[], id: string | null | undefined): EventRecord | undefined {
  return events.find((e) => e.id === id);
}

export function getVenue(id: string | null | undefined): Venue | undefined {
  return VENUES.find((v) => v.id === id);
}

export function equipName(id: string): string {
  return EQUIP.find((x) => x.id === id)?.name ?? id;
}

/** How many units of `equipId` are already reserved by other events. */
export function reservedQty(events: EventRecord[], equipId: string, excludeEventId?: string | null): number {
  return events.reduce((n, e) => {
    if (e.id === excludeEventId) return n;
    if (e.equipState !== "reserved") return n;
    const line = (e.equip || []).find((x) => x.id === equipId);
    return n + (line ? line.qty : 0);
  }, 0);
}

/** How many units of `equipId` remain free, ignoring `excludeEventId`'s own hold. */
export function freeQty(events: EventRecord[], equipId: string, excludeEventId?: string | null): number {
  const item = EQUIP.find((x) => x.id === equipId);
  if (!item) return 0;
  return item.total - reservedQty(events, equipId, excludeEventId);
}

export interface SuitabilityReason {
  level: "block" | "warn";
  text: string;
}

export interface Suitability {
  verdict: "Suitable" | "Suitable with caveats" | "Not suitable";
  blocked: boolean;
  reasons: SuitabilityReason[];
}

/** Whether `venue` can host `event`, and why not / with what caveats. */
export function suitability(events: EventRecord[], venue: Venue, event: EventRecord): Suitability {
  const reasons: SuitabilityReason[] = [];
  if (event.pax > venue.cap) {
    reasons.push({ level: "block", text: `Capacity ${venue.cap} is below the expected attendance of ${event.pax}.` });
  }
  if (event.layout && venue.layouts.indexOf(event.layout) === -1) {
    reasons.push({ level: "block", text: `Does not support a ${event.layout} layout.` });
  }
  (event.facilities || []).forEach((f) => {
    if (venue.facilities.indexOf(f) === -1) {
      reasons.push({ level: "warn", text: `${f} is not available at this venue.` });
    }
  });
  if ((event.access || []).indexOf("Step-free access") > -1 && !venue.stepFree) {
    reasons.push({ level: "block", text: "No step-free access, which this event requires." });
  }
  const clash = events.find(
    (o) => o.id !== event.id && o.venue === venue.id && o.date === event.date && (o.bookingState === "approved" || o.bookingState === "pending")
  );
  if (clash) {
    reasons.push({ level: "block", text: `Already booked for ${clash.name} on ${event.date}.` });
  }
  const blocked = reasons.some((r) => r.level === "block");
  return {
    verdict: blocked ? "Not suitable" : reasons.length ? "Suitable with caveats" : "Suitable",
    blocked,
    reasons,
  };
}
