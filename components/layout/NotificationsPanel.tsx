"use client";

import { useApp } from "@/lib/state/app-context";
import styles from "./NotificationsPanel.module.css";

export function NotificationsPanel() {
  const app = useApp();
  const mine = app.state.notifs.filter((n) => n.to === app.state.role);

  return (
    <div className={`${styles.panel} cs-animate-in`}>
      <div className={styles.header}>
        <div className={styles.headerTitle}>Notifications</div>
        <button className={styles.markRead} onClick={app.markAllRead}>
          Mark all read
        </button>
      </div>
      <div className={styles.list}>
        {mine.map((n) => (
          <div key={n.id} className={`${styles.item} ${n.read ? styles.itemRead : styles.itemUnread}`}>
            <div className={styles.itemTop}>
              <span className={styles.itemTitle}>{n.title}</span>
              <span className={styles.itemWhen}>{n.when}</span>
            </div>
            {n.eventName && <div className={styles.itemEvent}>{n.eventName}</div>}
            <div className={styles.itemBody}>{n.body}</div>
            <div className={styles.itemActions}>
              {n.eventId !== undefined && (
                <button className={styles.itemAction} onClick={() => app.openNotification(n.id)}>
                  Open event
                </button>
              )}
              {!n.read && (
                <button className={styles.itemAction} onClick={() => app.markRead(n.id)}>
                  Mark as read
                </button>
              )}
            </div>
          </div>
        ))}
        {mine.length === 0 && <div className="empty-state">Nothing yet for this role.</div>}
        {app.state.olderNotifs && (
          <button className={styles.showOlder} onClick={app.loadOlderNotifs}>
            Show older
          </button>
        )}
      </div>
    </div>
  );
}
