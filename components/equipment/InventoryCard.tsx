import { ProgressBar } from "@/components/ui/ProgressBar";
import type { EquipmentCatalogueItem } from "@/lib/types";

export function InventoryCard({ item, free }: { item: EquipmentCatalogueItem; free: number }) {
  const pct = item.total ? Math.round((free / item.total) * 100) : 0;
  const barColor = free === 0 ? "#FF4D5E" : pct < 40 ? "#FFBF00" : "#1466FF";

  return (
    <div className="card" style={{ padding: "16px 18px" }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, lineHeight: 1.35 }}>{item.name}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 12 }}>
        <span
          className="tabular"
          style={{ fontFamily: "var(--font-work-sans)", fontWeight: 300, fontSize: 36, lineHeight: 1, letterSpacing: "-.03em", color: free === 0 ? "var(--bad-fg)" : "var(--blue-deep)" }}
        >
          {free}
        </span>
        <span className="tabular" style={{ fontSize: 13, color: "var(--text-subtle)" }}>
          / {item.total} free
        </span>
      </div>
      <div style={{ marginTop: 12 }}>
        <ProgressBar pct={pct} color={barColor} thin />
      </div>
      <div className="tabular" style={{ fontSize: 11.5, color: "var(--text-faint)", marginTop: 9 }}>
        {item.total - free} committed to confirmed events
      </div>
    </div>
  );
}
