import { expect, test, type Page } from "@playwright/test";
import { GRACE, MAYA, PASSWORD, PRIYA, SAM, WEI, signIn } from "./support/app";
import { DANIEL, observed } from "./support/venues";
import { sql } from "./support/scenario";

/**
 * US01 — Secure Login (functional).
 * "As a user, I want to log in securely so that only authorised users can access the system."
 *
 * Test cases: docs/testing/US01_Secure_Login_Test_Cases.xlsx (TC-001 to TC-012), run here in a real
 * browser against the functional-test database. Accounts that get locked, fail or change their password
 * are test-only ones (tests/functional/support/seed_users.py), so no other test is affected.
 */
const LOCKOUT = { email: "lockout.test@connectsphere.edu" };
const FAIL_COUNT = { email: "failcount.test@connectsphere.edu" };
const PASSWORD_CHANGE = { email: "password.test@connectsphere.edu" };
const INACTIVE = { email: "inactive.test@student.connectsphere.edu" };
const WRONG = "WrongPass1";
const DENIED = "Incorrect email or password";
const LOCKED = "Too many failed attempts. Try again in a few minutes.";

const emailBox = (page: Page) => page.getByPlaceholder("you@connectsphere.edu");
const passwordBox = (page: Page) => page.locator('input[type="password"]');
const errorBox = (page: Page) => page.locator(".callout-danger");

/** Types the credentials on /login, presses Sign in and waits for the server's answer. */
async function attempt(page: Page, email: string, password: string): Promise<number> {
  if (!page.url().endsWith("/login")) await page.goto("/login");
  await emailBox(page).fill(email);
  await passwordBox(page).fill(password);
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/auth/login")),
    page.getByRole("button", { name: "Sign in", exact: true }).click(),
  ]);
  return response.status();
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);
}

test.describe("US01 - Secure Login", () => {
  test("[TC-001] [US01-AC1] login with valid credentials", async ({ page }, info) => {
    await signIn(page, MAYA, /\/my-events/);
    await expect(page.getByText("My event requests")).toBeVisible();
    await expect(page.getByText(MAYA.email)).toBeVisible();
    observed(info, `Signing in as ${MAYA.email} opened /my-events ("My event requests"); the sidebar showed ${MAYA.email}.`);
  });

  test("[TC-002] [US01-AC1] each role lands on its own home page after login", async ({ page }, info) => {
    const seen: string[] = [];
    for (const [who, landing] of [[PRIYA, "/queue"], [MAYA, "/my-events"], [DANIEL, "/bookings"], [WEI, "/equipment"], [SAM, "/browse"],
      [GRACE, "/assignments"]] as const) {
      await signIn(page, who, new RegExp(`${landing}$`));
      seen.push(`${who.email} -> ${landing}`);
      await signOut(page);
    }
    observed(info, `${seen.join("; ")}. Each account signed out back to /login.`);
  });

  test("[TC-003] [US01-AC2] login with a valid email and wrong password is denied", async ({ page }, info) => {
    expect(await attempt(page, MAYA.email, WRONG)).toBe(401);
    await expect(page).toHaveURL(/\/login$/);
    await expect(errorBox(page)).toHaveText(DENIED);
    await expect(passwordBox(page)).toHaveValue("");
    expect(await attempt(page, MAYA.email, PASSWORD)).toBe(200);
    await expect(page).toHaveURL(/\/my-events$/);
    observed(info, `Stayed on /login with "${DENIED}" and the password field cleared. Signing in correctly afterwards worked.`);
  });

  test("[TC-004] [US01-AC2] login with an unregistered email is denied with the same message", async ({ page }, info) => {
    expect(await attempt(page, "nobody@connectsphere.edu", PASSWORD)).toBe(401);
    await expect(errorBox(page)).toHaveText(DENIED);
    observed(info, `An unregistered email got "${DENIED}", the same message as a wrong password.`);
  });

  test("[TC-005] [US01-AC2] login to a deactivated account is denied", async ({ page }, info) => {
    expect(await attempt(page, INACTIVE.email, PASSWORD)).toBe(401);
    await expect(errorBox(page)).toHaveText(DENIED);
    await expect(page).toHaveURL(/\/login$/);
    observed(info, `The deactivated account's correct password was refused with "${DENIED}".`);
  });

  test("[TC-006] [US01-AC3] the account is locked after 5 consecutive failed attempts", async ({ page }, info) => {
    for (let i = 1; i <= 5; i++) {
      expect(await attempt(page, LOCKOUT.email, WRONG), `attempt ${i}`).toBe(401);
      await expect(errorBox(page), `attempt ${i}`).toHaveText(DENIED);
    }
    expect(await attempt(page, LOCKOUT.email, PASSWORD)).toBe(429);
    await expect(errorBox(page)).toHaveText(LOCKED);
    await expect(page).toHaveURL(/\/login$/);
    observed(info, `Attempts 1-5 showed "${DENIED}". The correct password was then refused with "${LOCKED}".`);
  });

  test("[TC-007] [US01-AC3] 4 failed attempts don't lock the account and a successful login resets the count", async ({ page }, info) => {
    for (let i = 1; i <= 4; i++) expect(await attempt(page, FAIL_COUNT.email, WRONG), `attempt ${i}`).toBe(401);
    expect(await attempt(page, FAIL_COUNT.email, PASSWORD)).toBe(200);
    await expect(page).toHaveURL(/\/bookings$/);
    await signOut(page);
    expect(await attempt(page, FAIL_COUNT.email, WRONG)).toBe(401);
    await expect(errorBox(page)).toHaveText(DENIED);
    expect(await attempt(page, FAIL_COUNT.email, PASSWORD)).toBe(200);
    await expect(page).toHaveURL(/\/bookings$/);
    observed(info, `After 4 failures the correct password signed in (/bookings). After signing out, one more failure showed "${DENIED}" (not the lockout message) and the next correct password signed in.`);
  });

  test("[TC-008] [US01-AC3] a locked account can log in again after the 15-minute lockout", async ({ page }, info) => {
    const email = LOCKOUT.email;
    // TC-006 may not have run first, so make sure the account is locked through the login page.
    for (let i = 0; i < 5; i++) await attempt(page, email, WRONG);
    expect(await attempt(page, email, PASSWORD)).toBe(429);
    // Given: 15 minutes pass. Moves the stored lock back instead of waiting (backend: test_ac3_lockout.py uses a clock).
    sql("UPDATE users SET locked_until = datetime('now', '-16 minutes') WHERE email = ?", [email]);
    expect(await attempt(page, email, PASSWORD)).toBe(200);
    await expect(page).toHaveURL(/\/equipment$/);
    observed(info, `The account was locked (429). With its lock set to 16 minutes ago, the correct password signed in to /equipment.`);
  });

  test("[TC-009] [US01-AC4] the session ends automatically after 30 minutes of inactivity", async ({ page }, info) => {
    await page.clock.install();
    await signIn(page, MAYA, /\/my-events/);
    await page.clock.fastForward("30:00");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText("You were signed out after 30 minutes of inactivity.")).toBeVisible();
    expect((await page.request.get("/api/auth/me")).status()).toBe(401);
    await page.goBack();
    await expect(page.getByText("My event requests")).toHaveCount(0);
    observed(info, `After 30 minutes without input (browser clock moved forward) the app went to /login with "You were signed out after 30 minutes of inactivity."; the server session was ended (GET /auth/me 401) and Back did not show My events.`);
  });

  test("[TC-010] [US01-AC4] activity within 30 minutes keeps the session alive", async ({ page }, info) => {
    await page.clock.install();
    await signIn(page, MAYA, /\/my-events/);
    await page.clock.fastForward("29:00");
    await page.getByRole("link", { name: "New request" }).click();
    await expect(page).toHaveURL(/\/new-request$/);
    await page.clock.fastForward("29:00");
    await page.getByRole("link", { name: "My events" }).click();
    await expect(page).toHaveURL(/\/my-events$/);
    await page.clock.fastForward("01:00");
    await expect(page).toHaveURL(/\/my-events$/);
    expect((await page.request.get("/api/auth/me")).status()).toBe(200);
    observed(info, `Idle 29 min then clicked New request (/new-request); idle another 29 min then clicked My events (/my-events); still signed in a minute later and GET /auth/me returned 200.`);
  });

  test("[TC-011] [US01-AC5] credentials and the session cookie are only sent over HTTPS", async () => {
    test.skip(true, "Needs the deployed site with a TLS certificate; localhost serves plain HTTP. The backend's HTTPS-only rules are tested in tests/us01_secure_login/test_ac5_tls.py.");
  });

  test("[TC-012] [US01-AC6] passwords are stored hashed, never in plain text", async ({ page }, info) => {
    const hashOf = () => String(sql("SELECT password_hash FROM users WHERE email = ?", [PASSWORD_CHANGE.email])[0][0]);
    const before = hashOf();
    expect(before.startsWith("$argon2id$")).toBe(true);
    expect(before).not.toContain(PASSWORD);

    const changed = "Changed-Password-2";
    await attempt(page, PASSWORD_CHANGE.email, PASSWORD);
    await expect(page).toHaveURL(/\/equipment$/);
    await page.getByRole("button", { name: "Change password" }).click();
    const fields = page.locator("form input[type=password]");
    await fields.nth(0).fill(PASSWORD);
    await fields.nth(1).fill(changed);
    await fields.nth(2).fill(changed);
    await page.locator("form").getByRole("button", { name: "Change password" }).click();
    await expect(page.locator(".cs-animate-toast")).toContainText("Password changed.");

    const after = hashOf();
    expect(after.startsWith("$argon2id$")).toBe(true);
    expect(after).not.toBe(before);
    expect(after).not.toContain(changed);
    const columns = sql("SELECT * FROM users WHERE email = ?", [PASSWORD_CHANGE.email])[0].map(String);
    expect(columns.some((value) => value.includes(changed) || value.includes(PASSWORD))).toBe(false);

    await signOut(page);
    expect(await attempt(page, PASSWORD_CHANGE.email, PASSWORD)).toBe(401);
    expect(await attempt(page, PASSWORD_CHANGE.email, changed)).toBe(200);
    observed(info, `password_hash started with $argon2id$ and didn't contain the password, before and after changing it through Change password; the hash changed and no column held either password. Afterwards the old password was refused and the new one worked.`);
  });
});
