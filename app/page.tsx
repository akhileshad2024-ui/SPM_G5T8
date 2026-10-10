"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_ROUTE } from "@/lib/data";
import { useApp } from "@/lib/app-context";

/** Root route: never rendered for long — just sends you to the right place. */
export default function RootPage() {
  const app = useApp();
  const router = useRouter();

  useEffect(() => {
    if (!app.state.authChecked) return;
    router.replace(app.state.authed ? DEFAULT_ROUTE[app.state.role] : "/login");
  }, [app.state.authChecked, app.state.authed, app.state.role, router]);

  return null;
}
