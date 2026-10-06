/**
 * Pure, framework-free helpers for deriving values from the event list.
 * Kept separate from `app-context.tsx` so they can be unit tested or
 * reused without pulling in React.
 */
import { EQUIP } from "./data";
import type { EventRecord, Venue } from "./types";
import { availabilityIssues, hasStepFreeAccess, venueHas } from "./venue-rules";

export function getEvent(events: EventRecord[], id: string | null | undefined): EventRecord | undefined {
  return events.find((e) => e.id === id);
}

export function getVenue(venues: Venue[], id: string | null | undefined): Venue | undefined {
  return venues.find((v) => v.id === id);
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
  if (event.layout && !venueHas(venue.layouts, event.layout)) {
    reasons.push({ level: "block", text: `Does not support a ${event.layout} layout.` });
  }
  (event.facilities || []).forEach((f) => {
    if (!venueHas(venue.facilities, f)) {
      reasons.push({ level: "warn", text: `${f} is not available at this venue.` });
    }
  });
  (event.access || []).forEach((a) => {
    if (a.toLowerCase() === "step-free access") {
      if (!hasStepFreeAccess(venue)) reasons.push({ level: "block", text: "No step-free access, which this event requires." });
    } else if (!venueHas(venue.accessibility, a)) {
      reasons.push({ level: "warn", text: `${a} is not listed for this venue.` });
    }
  });
  // Date/time checks use the occupied window: setup and turnaround included (Week 7 change #1).
  reasons.push(...availabilityIssues(events, venue, event));
  const blocked = reasons.some((r) => r.level === "block");
  return {
    verdict: blocked ? "Not suitable" : reasons.length ? "Suitable with caveats" : "Suitable",
    blocked,
    reasons,
  };
}
