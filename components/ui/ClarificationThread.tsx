"use client";

import { useRef, useState } from "react";
import { useApp } from "@/lib/state/app-context";
import type { EventRecord } from "@/lib/types";

/** US09 AC1–AC3: one saved question/reply, shared by organiser and coordinator views. */
export function ClarificationThread({ event }: { event: EventRecord }) {
  const app = useApp();
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  const question = event.clarification;
  if (!question) return null;

  const canReply = app.state.role === "organiser" && event.status === "pending_clarification"
    && !question.response && event.backendId !== undefined;

  async function send() {
    if (pending.current || event.backendId === undefined) return;
    pending.current = true;
    setSaving(true);
    try {
      if (await app.saveClarificationReply(event.backendId, message)) setMessage("");
    } finally {
      pending.current = false;
      setSaving(false);
    }
  }

  return (
    <section style={{ display: "grid", gap: 10 }} aria-label="Clarification conversation">
      <h3>{question.kind === "amendment" ? "Amendment request" : "Clarification request"}</h3>
      {/* Earlier rounds remain visible instead of being overwritten by a new question. */}
      {question.history?.map((past, index) => (
        <div key={index}>
          <p>{past.requestedBy}: {past.message}</p>
          {past.response && <p>{past.response.respondedBy}: {past.response.message}</p>}
        </div>
      ))}
      <div>{question.requestedBy}: {question.message}</div>
      {question.response && <div><strong>{question.response.respondedBy}</strong>: {question.response.message}</div>}
      {canReply && (
        <div style={{ display: "grid", gap: 8 }}>
          <label htmlFor="clarification-response">Response</label>
          <textarea id="clarification-response" className="textarea-input" value={message}
            onChange={(e) => setMessage(e.target.value)} disabled={saving} />
          <button className="btn btn-primary" onClick={() => void send()} disabled={saving || !message.trim()}>
            {saving ? "Saving…" : "Send response"}
          </button>
        </div>
      )}
    </section>
  );
}
