"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_FOR } from "@/lib/data";
import { useApp } from "@/lib/app-context";
import styles from "./Sidebar.module.css";

/** Left-hand navigation: role-scoped links, unread-work badges, and the signed-in user. */
export function Sidebar() {
  const app = useApp();
  const pathname = usePathname();
  const { role, events } = app.state;
  const me = app.me;

  const badges: Record<string, number> = {
    "/queue": events.filter((e) => e.status === "submitted" || e.status === "under_review").length,
    "/bookings": events.filter((e) => e.bookingState === "pending").length,
    "/equipment": events.filter(
      (e) => e.equipState === "requested" && (e.status === "planning" || e.status === "approved" || e.status === "confirmed")
    ).length,
  };

  const initials = me.person
    .split(" ")
    .map((x) => x[0])
    .join("");

  return (
    <div className={styles.sidebar}>
      <div className={styles.brand}>
        <div className={styles.brandName}>
          Connect<span className={styles.brandStrong}>Sphere</span>
        </div>
        <div className={styles.brandTagline}>Event operations</div>
      </div>

      <div className={styles.nav}>
        <div className={styles.roleLabel}>{me.label}</div>
        {NAV_FOR[role].map(([href, label]) => {
          const active = pathname === href;
          const badge = badges[href] ?? 0;
          return (
            <Link key={href} href={href} className={`${styles.navItem} ${active ? styles.navItemActive : ""}`}>
              <span className={styles.navLabel}>{label}</span>
              {badge > 0 && (
                <span className={`${styles.navBadge} ${active ? styles.navBadgeActive : ""}`}>{badge}</span>
              )}
            </Link>
          );
        })}
      </div>

      <div className={styles.footer}>
        <div className={styles.who}>
          <span className={styles.avatar}>{initials}</span>
          <span className={styles.whoBody}>
            <span className={styles.whoName}>{me.person}</span>
            <span className={styles.whoEmail}>{me.email}</span>
          </span>
        </div>
        <button className={styles.signOut} onClick={app.signOut}>
          Sign out
        </button>
      </div>
    </div>
  );
}
