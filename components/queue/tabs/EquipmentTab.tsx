"use client";
import { EquipmentManager } from "@/components/equipment/EquipmentManager";
import type { EventRecord } from "@/lib/types";

export function EquipmentTab({ event }: { event: EventRecord }) {
  return event.backendId === undefined ? <p>Save this event before recording equipment.</p>
    : <EquipmentManager key={event.backendId} eventId={event.backendId} coordinator />;
}
