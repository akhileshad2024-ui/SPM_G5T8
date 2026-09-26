"use client";

import { useState, type FormEvent } from "react";
import { ApiError, apiFetch } from "@/lib/api";
import { useApp } from "@/lib/app-context";

/** Must match MIN_PASSWORD_LENGTH in backend/schemas.py. */
const MIN_PASSWORD_LENGTH = 8;

/** Lets the signed-in user change their own password. Other sessions are signed out; this one stays. */
export function ChangePasswordDialog({ onClose }: { onClose: () => void }) {
  const app = useApp();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const validate = (): string | null => {
    if (!current) return "Enter your current password.";
    if (next.length < MIN_PASSWORD_LENGTH) return `New password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
    if (next !== confirm) return "New passwords don't match.";
    if (next === current) return "New password must be different from the current one.";
    return null;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving) return;
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    setSaving(true);
    try {
      await apiFetch("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ current_password: current, new_password: next }),
      });
      app.flash("Password changed. You've been signed out on other devices.");
      onClose();
    } catch (err) {
      if (err instanceof ApiError && (err.status === 400 || err.status === 429)) {
        setError(err.message);
        setCurrent("");
      } else {
        app.handleApiError(err);
        if (err instanceof ApiError && err.status === 401) onClose();
      }
    } finally {
      setSaving(false);
    }
  };

  const field = (label: string, value: string, set: (v: string) => void, autoComplete: string) => (
    <div className="field">
      <label className="eyebrow">{label}</label>
      <input
        className="text-input"
        type="password"
        autoComplete={autoComplete}
        value={value}
        onChange={(e) => {
          set(e.target.value);
          setError(null);
        }}
        style={{ fontSize: 14 }}
      />
    </div>
  );

  return (
    <div
      onClick={onClose}
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
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="cs-animate-in"
        style={{
          width: "100%",
          maxWidth: 440,
          background: "#fff",
          borderRadius: 10,
          boxShadow: "0 18px 40px -12px rgba(10,14,26,.4)",
          overflow: "hidden",
          color: "var(--ink)",
        }}
      >
        <div style={{ padding: "20px 24px 16px", borderBottom: "1px solid rgba(10,14,26,.08)" }}>
          <div style={{ fontFamily: "var(--font-open-sans)", fontWeight: 800, fontSize: 19, letterSpacing: "-.02em" }}>
            Change password
          </div>
          <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.55, marginTop: 6 }}>
            You&apos;ll stay signed in here. Any other devices using this account will be signed out.
          </div>
        </div>
        <div style={{ padding: "20px 24px", display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Hidden username helps password managers save the new password against the right account. */}
          <input type="email" autoComplete="username" value={app.me.email} readOnly hidden />
          {field("Current password", current, setCurrent, "current-password")}
          {field("New password", next, setNext, "new-password")}
          {field("Confirm new password", confirm, setConfirm, "new-password")}
          {error && <div className="callout callout-danger">{error}</div>}
        </div>
        <div style={{ padding: "0 24px 22px", display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button type="button" className="btn btn-ghost" style={{ height: 38, padding: "0 16px" }} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" style={{ height: 38, padding: "0 18px" }} disabled={saving}>
            {saving ? "Saving…" : "Change password"}
          </button>
        </div>
      </form>
    </div>
  );
}
