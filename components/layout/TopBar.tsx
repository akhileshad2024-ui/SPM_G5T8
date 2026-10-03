"use client";

import { usePathname } from "next/navigation";
import { useApp } from "@/lib/app-context";
import { getPageMeta } from "@/lib/page-meta";
import { NotificationsPanel } from "./NotificationsPanel";
import styles from "./TopBar.module.css";

export function TopBar() {
  const app = useApp();
  const pathname = usePathname();
  const { title, subtitle } = getPageMeta(pathname, app.state.events, app.state.venues);
  const unread = app.state.notifs.filter((n) => n.to === app.state.role && !n.read).length;

  return (
    <div className={styles.bar}>
      <div className={styles.titleBlock}>
        <div className={styles.title}>{title}</div>
        <div className={styles.subtitle}>{subtitle}</div>
      </div>
      <div className={styles.spacer} />
      <div className={styles.notifWrap}>
        <button className={styles.notifButton} onClick={app.toggleNotifs}>
          <span>Notifications</span>
          {unread > 0 && <span className={styles.notifCount}>{unread}</span>}
        </button>
        {app.state.notifsOpen && <NotificationsPanel />}
      </div>
    </div>
  );
}
