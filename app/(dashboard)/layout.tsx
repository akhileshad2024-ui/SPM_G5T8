"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useApp } from "@/lib/app-context";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { Modal } from "@/components/Modal";
import { Toast } from "@/components/Toast";

/** Shell shared by every signed-in page: sidebar, top bar, and the global modal/toast. */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const app = useApp();
  const router = useRouter();

  useEffect(() => {
    if (!app.state.authed) router.replace("/login");
  }, [app.state.authed, router]);

  if (!app.state.authed) return null;

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
