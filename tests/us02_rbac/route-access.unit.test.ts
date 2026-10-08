/**
 * US02 — "can perform only the actions permitted for their assigned role".
 *
 * Unit tests for the page-level access rules in lib/auth/route-access.ts: which pages each
 * role sees in the sidebar (NAV_FOR), where they land (DEFAULT_ROUTE), and
 * which URLs the client-side guard lets them open (canAccessRoute).
 */
import { describe, expect, it } from "vitest";
import { canAccessRoute, DEFAULT_ROUTE, NAV_FOR, NO_PAGE_PERMISSION, routeRedirect } from "../../lib/auth/route-access";
import type { Role } from "../../lib/types";

const ROLES: Role[] = ["organiser", "coordinator", "venue", "tech", "attendee"];
const ALL_PAGES = ROLES.flatMap((r) => NAV_FOR[r].map(([route]) => route));

describe("sidebar per role", () => {
  it.each<[Role, string[]]>([
    ["organiser", ["My events", "New request"]],
    ["coordinator", ["Review queue", "Pipeline", "Venues"]],
    ["venue", ["Booking requests", "Venue catalogue"]],
    ["tech", ["Equipment"]],
    ["attendee", ["Browse events"]],
  ])("%s sees only their own pages", (role, labels) => {
    expect(NAV_FOR[role].map(([, label]) => label)).toEqual(labels);
  });

  it("no page appears in two roles' navigation", () => {
    expect(new Set(ALL_PAGES).size).toBe(ALL_PAGES.length);
  });
});

describe("landing page after sign-in", () => {
  it.each(ROLES)("%s lands on a page they are allowed to open", (role) => {
    expect(canAccessRoute(role, DEFAULT_ROUTE[role])).toBe(true);
  });

  it.each<[Role, string]>([
    ["organiser", "/my-events"],
    ["coordinator", "/queue"],
    ["venue", "/bookings"],
    ["tech", "/equipment"],
    ["attendee", "/browse"],
  ])("%s lands on %s", (role, route) => {
    expect(DEFAULT_ROUTE[role]).toBe(route);
  });
});

describe("canAccessRoute", () => {
  it.each(ROLES)("%s can open each of their own pages", (role) => {
    for (const [route] of NAV_FOR[role]) expect(canAccessRoute(role, route)).toBe(true);
  });

  it.each(ROLES)("%s cannot open any other role's page", (role) => {
    const own = new Set(NAV_FOR[role].map(([route]) => route));
    for (const page of ALL_PAGES.filter((p) => !own.has(p))) {
      expect(canAccessRoute(role, page), `${role} -> ${page}`).toBe(false);
    }
  });

  it("allows sub-pages of a permitted page", () => {
    expect(canAccessRoute("coordinator", "/queue/EVT-2041")).toBe(true);
  });

  it("does not treat a look-alike path as a permitted page", () => {
    expect(canAccessRoute("coordinator", "/queue-admin")).toBe(false);
    expect(canAccessRoute("organiser", "/my-events-all")).toBe(false);
  });

  it.each(ROLES)("%s cannot open unknown pages", (role) => {
    expect(canAccessRoute(role, "/admin")).toBe(false);
    expect(canAccessRoute(role, "/")).toBe(false);
  });

  it("blocks the organiser from the coordinator, venue and tech pages (TC-017)", () => {
    expect(canAccessRoute("organiser", "/queue")).toBe(false);
    expect(canAccessRoute("organiser", "/catalogue")).toBe(false);
    expect(canAccessRoute("organiser", "/equipment")).toBe(false);
  });
});

describe("authorisation error when opening another role's page (US02 AC3)", () => {
  it.each(ROLES)("%s stays on their own pages with no error", (role) => {
    for (const [route] of NAV_FOR[role]) expect(routeRedirect(role, route)).toBeNull();
  });

  it("sends the user to their home page with an authorisation error", () => {
    expect(routeRedirect("organiser", "/queue")).toEqual({ to: "/my-events", message: NO_PAGE_PERMISSION });
  });

  it.each(ROLES)("%s is redirected home from every other role's page", (role) => {
    const own = new Set(NAV_FOR[role].map(([route]) => route));
    for (const page of ALL_PAGES.filter((p) => !own.has(p))) {
      expect(routeRedirect(role, page)).toEqual({ to: DEFAULT_ROUTE[role], message: NO_PAGE_PERMISSION });
    }
  });

  it("explains the problem in plain words", () => {
    expect(NO_PAGE_PERMISSION).toBe("You don't have permission to view that page.");
  });
});
