"use client";

import { useApp } from "@/lib/state/app-context";
import { reviewQueue } from "@/lib/events/visibility";
import { QueueList } from "@/components/queue/QueueList";
import { EventWorkspace } from "@/components/queue/EventWorkspace";

export default function QueuePage() {
  const app = useApp();
  const { events, search, queueFilter, selectedId } = app.state;

  const list = reviewQueue(events, queueFilter, app.me.person, search);

  const selId = list.some((e) => e.id === selectedId) ? selectedId : list[0]?.id ?? selectedId;
  const selected = app.event(selId);

  return (
    <div style={{ display: "flex", alignItems: "stretch", minHeight: "calc(100vh - 60px)" }}>
      <QueueList events={list} selectedId={selId} />
      {selected ? (
        <EventWorkspace event={selected} />
      ) : (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-subtle)", fontSize: 13 }}>
          No events match this filter.
        </div>
      )}
    </div>
  );
}
