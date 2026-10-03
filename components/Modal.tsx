"use client";

import { useApp } from "@/lib/app-context";

/** The single shared confirm/reason dialog used by review, booking, and change-request actions. */
export function Modal() {
  const app = useApp();
  const modal = app.state.modal;
  if (!modal) return null;

  return (
    <div
      onClick={app.closeModal}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(10,14,26,.46)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 28,
        zIndex: 60,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="cs-animate-in"
        style={{
          width: "100%",
          maxWidth: 520,
          background: "#fff",
          borderRadius: 10,
          boxShadow: "0 18px 40px -12px rgba(10,14,26,.4)",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid rgba(10,14,26,.08)" }}>
          <div style={{ fontFamily: "var(--font-open-sans)", fontWeight: 800, fontSize: 19, letterSpacing: "-.02em" }}>
            {modal.title}
          </div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.55, marginTop: 6 }}>{modal.body}</div>
        </div>
        <div style={{ padding: "20px 24px" }}>
          <label className="eyebrow" style={{ display: "block", marginBottom: 7 }}>
            {modal.label}
          </label>
          <textarea
            className="textarea-input"
            style={{ width: "100%", fontSize: 14 }}
            rows={4}
            value={app.state.modalText}
            onChange={(e) => app.setModalText(e.target.value)}
            placeholder={modal.placeholder}
          />
        </div>
        <div style={{ padding: "0 24px 22px", display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button className="btn btn-ghost" style={{ height: 38, padding: "0 16px" }} onClick={app.closeModal}>
            Cancel
          </button>
          <button className="btn btn-primary" style={{ height: 38, padding: "0 18px" }} onClick={app.confirmModal}>
            {modal.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
