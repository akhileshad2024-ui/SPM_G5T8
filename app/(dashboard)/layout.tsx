"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useApp } from "@/lib/app-context";
import { canAccessRoute, DEFAULT_ROUTE } from "@/lib/data";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { Modal } from "@/components/Modal";
import { Toast } from "@/components/Toast";

/** Shell shared by every signed-in page: sidebar, top bar, and the global modal/toast. */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const app = useApp();
  const router = useRouter();
  const pathname = usePathname();
  const { authChecked, authed, role } = app.state;
  const allowed = authed && canAccessRoute(role, pathname);

  useEffect(() => {
    if (!authChecked) return;
    if (!authed) router.replace("/login");
    else if (!allowed) router.replace(DEFAULT_ROUTE[role]);
  }, [authChecked, authed, allowed, role, router]);

  if (!authChecked || !allowed) return null;

  return (
    <div style={{ display: "flex", minHeight: "100vh", background: "var(--bg)" }}>
      <Sidebar />
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <TopBar />
        <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
      </div>
      <Modal />
      <Toast />
    </div>
  );
}
