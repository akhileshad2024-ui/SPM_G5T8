import { STATUS } from "@/lib/data/options";
import styles from "./LoginHero.module.css";

const STATS: Array<[string, string]> = [
  ["5", "Roles"],
  ["20", "Core features"],
  // Counted from the defined status set, so it stays right if the set changes.
  [String(Object.keys(STATUS).length), "Event statuses"],
];

/** Left-hand branding panel on the sign-in screen. */
export function LoginHero() {
  return (
    <div className={styles.hero}>
      <div>
        <div className={styles.logo}>
          Connect<span className={styles.logoStrong}>Sphere</span>
        </div>
        <div className={styles.tagline}>Event operations platform</div>
      </div>

      <div className={styles.pitch}>
        <div className={styles.headline}>One request, one thread, one source of truth.</div>
        <div className={styles.subhead}>
          From the first draft to the confirmed booking, every event moves through review, venue approval, and
          equipment reservation in one place — so the people coordinating it always know what is still outstanding.
        </div>
        <div className={styles.stats}>
          {STATS.map(([n, label]) => (
            <div key={label}>
              <div className={styles.statNumber}>{n}</div>
              <div className={styles.statLabel}>{label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.footer}>IS212 · Group 5 Team 8 · first release</div>
    </div>
  );
}
