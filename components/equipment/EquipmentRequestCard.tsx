"use client";
import { EQUIP } from "@/lib/data/options";
import { EquipmentManager } from "./EquipmentManager";
import { EventDetailsToggle } from "@/components/ui/EventDetails";
import { StatusHistoryToggle } from "@/components/ui/StatusHistory";
import type { EventRecord } from "@/lib/types";

export function EquipmentRequestCard({ event }: { event: EventRecord }) {
  return <div className="card" style={{ padding: 20 }}>
    <h2>{event.name}</h2>
    <p>{event.equip.map((line) => `${EQUIP.find((item) => item.id === line.id)?.name ?? line.id} × ${line.qty}`).join(" · ")}</p>
    <EventDetailsToggle event={event} />
    <StatusHistoryToggle event={event} />
    {event.backendId !== undefined && <EquipmentManager eventId={event.backendId} />}
  </div>;
}
