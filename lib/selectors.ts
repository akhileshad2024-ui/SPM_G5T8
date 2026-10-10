/**
 * Pure, framework-free helpers for deriving values from the event list.
 * Kept separate from `app-context.tsx` so they can be unit tested or
 * reused without pulling in React.
 */
import { EQUIP } from "./data/options";
import type { EventRecord, Venue } from "./types";

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
