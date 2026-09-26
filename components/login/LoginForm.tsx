"use client";

import { useState, type KeyboardEvent } from "react";
import { PEOPLE } from "@/lib/data";
import { useApp } from "@/lib/app-context";
import type { Role } from "@/lib/types";
import styles from "./LoginForm.module.css";

const ROLE_KEYS = Object.keys(PEOPLE) as Role[];

/** Right-hand sign-in panel: email/password form plus demo account shortcuts. */
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

  const pickAccount = (role: Role) => {
    setEmail(PEOPLE[role].email);
    setPassword("");
    setError(null);
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
        {error && <div className="callout callout-danger">{error}</div>}
        <button className={`btn btn-primary ${styles.submit}`} onClick={submit} disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </button>
      </div>

      <div className={styles.dividerRow}>
        <div className={styles.dividerLine} />
        <div className={styles.dividerLabel}>Demo accounts</div>
        <div className={styles.dividerLine} />
      </div>

      <div className={styles.accounts}>
        {ROLE_KEYS.map((role) => {
          const p = PEOPLE[role];
          const active = email === p.email;
          return (
            <button
              key={role}
              onClick={() => pickAccount(role)}
              className={`${styles.account} ${active ? styles.accountActive : ""}`}
            >
              <span className={styles.accountBody}>
                <span className={styles.accountPerson}>{p.person}</span>
                <span className={styles.accountEmail}>{p.email}</span>
              </span>
              <span className="pill-sm" style={{ background: "#F4F5F9", color: "#4A5169" }}>
                {p.label}
              </span>
            </button>
          );
        })}
      </div>
      <div className={styles.hint}>Pick an account to fill in its email, then enter the password set by the seed script.</div>
    </div>
  );
}
