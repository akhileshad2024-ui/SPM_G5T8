// @vitest-environment jsdom
/**
 * The pages that decide where you go: app/page.tsx (the root redirect), app/login/page.tsx,
 * app/(dashboard)/layout.tsx (the signed-in shell and its route guard) and app/layout.tsx (the root HTML).
 */
import { render, screen } from "@testing-library/react";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import RootPage from "../../app/page";
import LoginPage from "../../app/login/page";
import DashboardLayout from "../../app/(dashboard)/layout";
import RootLayout, { metadata } from "../../app/layout";
import { NO_PAGE_PERMISSION } from "../../lib/auth/route-access";
import { fakeApp } from "../helpers/fake-app";
import { navState, resetNext, router } from "../helpers/next-mocks";

let app = fakeApp();
vi.mock("@/lib/state/app-context", () => ({
  useApp: () => app,
  AppProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("next/navigation", async () => (await import("../helpers/next-mocks")).nextNavigation);
vi.mock("next/font/google", () => {
  const font = (name: string) => () => ({ variable: `font-${name}` });
  return { Open_Sans: font("open"), PT_Sans: font("pt"), Work_Sans: font("work") };
});
vi.mock("@/components/login/LoginHero", () => ({ LoginHero: () => <div>login hero</div> }));
vi.mock("@/components/login/LoginForm", () => ({ LoginForm: () => <div>login form</div> }));
vi.mock("@/components/layout/Sidebar", () => ({ Sidebar: () => <div>sidebar</div> }));
vi.mock("@/components/layout/TopBar", () => ({ TopBar: () => <div>top bar</div> }));
vi.mock("@/components/Modal", () => ({ Modal: () => <div>modal</div> }));
vi.mock("@/components/Toast", () => ({ Toast: () => <div>toast</div> }));

beforeEach(() => {
  resetNext();
  app = fakeApp();
});

describe("RootPage", () => {
  it("waits until the session check is done", () => {
    app = fakeApp({ state: { authChecked: false } });
    const { container } = render(<RootPage />);
    expect(container.innerHTML).toBe("");
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("sends a signed-in user to their role's home page", () => {
    app = fakeApp({ state: { role: "venue" } });
    render(<RootPage />);
    expect(router.replace).toHaveBeenCalledWith("/bookings");
  });

  it("sends everyone else to sign in", () => {
    app = fakeApp({ state: { authed: false } });
    render(<RootPage />);
    expect(router.replace).toHaveBeenCalledWith("/login");
  });
});

describe("LoginPage", () => {
  it("shows nothing until the session check is done", () => {
    app = fakeApp({ state: { authChecked: false, authed: false } });
    const { container } = render(<LoginPage />);
    expect(container.innerHTML).toBe("");
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("shows the sign-in screen to a signed-out user", () => {
    app = fakeApp({ state: { authed: false } });
    render(<LoginPage />);
    expect(screen.getByText("login hero")).toBeTruthy();
    expect(screen.getByText("login form")).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("sends a user who is already signed in to their home page", () => {
    app = fakeApp({ state: { role: "attendee" } });
    const { container } = render(<LoginPage />);
    expect(container.innerHTML).toBe("");
    expect(router.replace).toHaveBeenCalledWith("/browse");
  });
});

describe("DashboardLayout", () => {
  it("shows nothing until the session check is done", () => {
    app = fakeApp({ state: { authChecked: false } });
    const { container } = render(<DashboardLayout>page</DashboardLayout>);
    expect(container.innerHTML).toBe("");
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("sends a signed-out user to sign in", () => {
    app = fakeApp({ state: { authed: false } });
    navState.pathname = "/queue";
    const { container } = render(<DashboardLayout>page</DashboardLayout>);
    expect(container.innerHTML).toBe("");
    expect(router.replace).toHaveBeenCalledWith("/login");
  });

  it("shows the page inside the shell when the role may open it", () => {
    navState.pathname = "/queue";
    render(<DashboardLayout>the queue</DashboardLayout>);

    for (const part of ["sidebar", "top bar", "the queue", "modal", "toast"]) expect(screen.getByText(part)).toBeTruthy();
    expect(router.replace).not.toHaveBeenCalled();
    expect(app.flash).not.toHaveBeenCalled();
  });

  it("sends a role away from a page it may not open, and says why", () => {
    app = fakeApp({ state: { role: "attendee" } });
    navState.pathname = "/queue";
    const { container } = render(<DashboardLayout>the queue</DashboardLayout>);

    expect(container.innerHTML).toBe("");
    expect(app.flash).toHaveBeenCalledWith(NO_PAGE_PERMISSION, "bad");
    expect(router.replace).toHaveBeenCalledWith("/browse");
  });
});

describe("RootLayout", () => {
  it("wraps every page in the app provider with the three fonts", () => {
    const html = RootLayout({ children: "the app" }) as ReactElement<{ lang: string; className: string; children: ReactElement<{ children: ReactElement<{ children: ReactNode }> }> }>;

    expect(html.type).toBe("html");
    expect(html.props.lang).toBe("en");
    expect(html.props.className).toBe("font-open font-pt font-work");
    const body = html.props.children;
    expect(body.type).toBe("body");
    expect(isValidElement(body.props.children)).toBe(true);
    expect(body.props.children.props.children).toBe("the app");
    expect(metadata.title).toBe("ConnectSphere — Event operations");
  });
});
