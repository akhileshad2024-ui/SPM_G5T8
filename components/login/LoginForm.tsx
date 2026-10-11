"use client";

import { useState, type KeyboardEvent } from "react";
import { useApp } from "@/lib/state/app-context";
import styles from "./LoginForm.module.css";

/** Right-hand sign-in panel: email/password form. */
export function LoginForm() {
  const app = useApp();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    const result = await app.signIn(email, password);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      setPassword("");
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") submit();
  };

  return (
    <div className={styles.panel}>
      <div className={styles.title}>Sign in</div>
      <div className={styles.subtitle}>What you can see and do is determined by your role and your relationship to each event.</div>

      <div className={styles.form}>
        <div className="field">
          <label className="eyebrow">Work email</label>
          <input
            className={styles.input}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setError(null);
            }}
            onKeyDown={onKeyDown}
            type="email"
            autoComplete="username"
            placeholder="you@connectsphere.edu"
          />
        </div>
        <div className="field">
          <label className="eyebrow">Password</label>
          <input
            className={styles.input}
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              setError(null);
            }}
            onKeyDown={onKeyDown}
            placeholder="••••••••"
          />
        </div>
        {error ? (
          <div className="callout callout-danger">{error}</div>
        ) : (
          app.state.signInNotice && <div className="callout callout-warn">{app.state.signInNotice}</div>
        )}
        <button className={`btn btn-primary ${styles.submit}`} onClick={submit} disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </div>
    </div>
  );
}
