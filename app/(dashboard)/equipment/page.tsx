"use client";

import { useApp } from "@/lib/app-context";
import { EQUIP } from "@/lib/data";
import { InventoryCard } from "@/components/equipment/InventoryCard";
import { EquipmentRequestCard } from "@/components/equipment/EquipmentRequestCard";

export default function EquipmentPage() {
  const app = useApp();
  const { events } = app.state;

  const requests = events.filter((e) => e.equip.length > 0 && e.equipState && e.status !== "draft" && e.status !== "rejected");

  return (
    <div style={{ padding: "24px 26px 34px", display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(184px, 1fr))", gap: 12 }}>
        {EQUIP.map((item) => (
          <InventoryCard key={item.id} item={item} free={app.freeQty(item.id, null)} />
        ))}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="section-heading">Equipment requests</div>
        {requests.map((e) => (
          <EquipmentRequestCard key={e.id} event={e} />
        ))}
      </div>
    </div>
  );
}
