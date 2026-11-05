/**
 * Shared mocks for the Next.js modules the components import, so component and page tests
 * don't each invent their own. Use them with vi.mock in the test file:
 *
 *   vi.mock("next/navigation", async () => (await import("../helpers/next-mocks")).nextNavigation);
 *   vi.mock("next/link", async () => (await import("../helpers/next-mocks")).nextLink);
 *
 * Then drive them from the test: `navState.pathname = "/queue"`, `expect(router.push).toHaveBeenCalledWith("/login")`.
 */
import { createElement, type AnchorHTMLAttributes, type ReactNode } from "react";
import { vi } from "vitest";

export const router = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
};

/** What usePathname() / useParams() return; change it inside a test. */
export const navState: { pathname: string; params: Record<string, string> } = { pathname: "/", params: {} };

/** Call in beforeEach so one test's navigation doesn't leak into the next. */
export function resetNext() {
  Object.values(router).forEach((fn) => fn.mockReset());
  navState.pathname = "/";
  navState.params = {};
}

export const nextNavigation = {
  useRouter: () => router,
  usePathname: () => navState.pathname,
  useParams: () => navState.params,
  useSearchParams: () => new URLSearchParams(),
};

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; children?: ReactNode };

export const nextLink = {
  default: ({ href, children, ...rest }: LinkProps) => createElement("a", { href, ...rest }, children),
};
