import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

/**
 * The US13/US15 scenario events (tests/functional/support/seed_events.py), written straight to the
 * functional-test database because some of their states can't be reached through the API yet.
 */

// Keep in sync with playwright.config.ts.
const DATABASE = path.join(os.tmpdir(), "connectsphere-functional", "functional.db").replace(/\\/g, "/");
const SEED = path.join(__dirname, "seed_events.py");

export interface Scenario {
  /** Annual Research Symposium: Confirmed, venue booked, Projector x2 requested, registration open, 6-step history. */
  symposium: number;
  /** Startup Pitch Night: Approved, venue booking pending, no equipment, registration open. */
  pitch: number;
  /** Faculty Networking Mixer: Rejected with `reject` as the reason. */
  mixer: number;
  /** Unplanned Social: Submitted with only the basics, no coordinator. */
  bare: number;
  /** The venue booked for the symposium and requested for the pitch night. */
  venue: string;
  clarify: string;
  reject: string;
  suffix: string;
}

/** Adds a fresh set of the scenario events, their names ending in `suffix`. */
export function seedScenario(suffix: string): Scenario {
  const out = execFileSync(process.env.PYTHON ?? "python", [SEED, suffix], {
    env: { ...process.env, DATABASE_URL: `sqlite:///${DATABASE}` },
    encoding: "utf-8",
  });
  return { ...JSON.parse(out.trim().split("\n").pop()!), suffix };
}

/**
 * Runs one SQL statement on the functional-test database and returns the rows as JSON-decoded arrays.
 * For "Given" steps a real user can't take (letting 15 minutes pass) and for reading what was stored.
 */
export function sql(statement: string, params: unknown[] = []): unknown[][] {
  const script = [
    "import json, sqlite3, sys",
    "con = sqlite3.connect(sys.argv[1])",
    "rows = con.execute(sys.argv[2], json.loads(sys.argv[3])).fetchall()",
    "con.commit()",
    "print(json.dumps(rows, default=str))",
  ].join("\n");
  const out = execFileSync(process.env.PYTHON ?? "python", ["-c", script, DATABASE, statement, JSON.stringify(params)], { encoding: "utf-8" });
  return JSON.parse(out);
}

export const scenarioNames =(s: Pick<Scenario, "suffix">) => ({
  symposium: `Annual Research Symposium ${s.suffix}`,
  pitch: `Startup Pitch Night ${s.suffix}`,
  mixer: `Faculty Networking Mixer ${s.suffix}`,
  bare: `Unplanned Social ${s.suffix}`,
});
