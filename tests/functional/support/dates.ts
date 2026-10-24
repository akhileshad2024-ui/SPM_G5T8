/** Capture once per workflow so every step uses the same Singapore date. */
export function singaporeTestDate(now: Date) {
  const options = { timeZone: "Asia/Singapore", year: "numeric", month: "2-digit", day: "2-digit" } as const;
  const iso = new Intl.DateTimeFormat("en-CA", options).format(now);
  const label = new Intl.DateTimeFormat("en-GB", { ...options, month: "short" }).format(now);
  return { iso, label };
}
