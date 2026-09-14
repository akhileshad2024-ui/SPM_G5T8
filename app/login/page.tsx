"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/app-context";
import { DEFAULT_ROUTE } from "@/lib/data";
import { LoginHero } from "@/components/login/LoginHero";
import { LoginForm } from "@/components/login/LoginForm";

export default function LoginPage() {
  const app = useApp();
  const router = useRouter();

  useEffect(() => {
    if (app.state.authed) router.replace(DEFAULT_ROUTE[app.state.role]);
  }, [app.state.authed, app.state.role, router]);

  if (app.state.authed) return null;

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--ink)" }}>
      <LoginHero />
      <LoginForm />
    </div>
  );
}
