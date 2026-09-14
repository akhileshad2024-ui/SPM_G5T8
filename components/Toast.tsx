"use client";

import { useApp } from "@/lib/app-context";
import { Dot } from "./ui/Dot";

const TONE_COLOR: Record<string, string> = { ok: "#2EC8FF", warn: "#FFBF00", bad: "#FF4D5E" };

/** A short-lived confirmation banner ("Draft saved.", "Booking requested at ..."). */
export function Toast() {
  const app = useApp();
  const { toast, toastKind } = app.state;
  if (!toast) return null;

  return (
    <div
      className="cs-animate-toast"
      style={{ position: "fixed", left: "50%", bottom: 28, transform: "translateX(-50%)", zIndex: 80 }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          background: "var(--ink)",
          color: "#fff",
          padding: "13px 20px",
          borderRadius: 6,
          fontSize: 13.5,
          fontWeight: 700,
          boxShadow: "0 18px 40px -12px rgba(10,14,26,.5)",
          maxWidth: 560,
        }}
      >
        <Dot color={TONE_COLOR[toastKind] ?? TONE_COLOR.ok} />
        <span>{toast}</span>
      </div>
    </div>
  );
}
