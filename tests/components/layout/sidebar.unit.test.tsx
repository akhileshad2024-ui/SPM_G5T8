// @vitest-environment jsdom
/**
 * Example test for a component that reads the app context and uses Next.js navigation:
 * fake both with the shared helpers, interact, and check what was called.
 * components/layout/Sidebar.tsx. Whoever owns the layout chunk extends this to 100%.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "../../../components/layout/Sidebar";
import { fakeApp } from "../../helpers/fake-app";
import { navState, resetNext } from "../../helpers/next-mocks";

let app = fakeApp();
vi.mock("@/lib/state/app-context", () => ({ useApp: () => app }));
vi.mock("next/navigation", async () => (await import("../../helpers/next-mocks")).nextNavigation);
vi.mock("next/link", async () => (await import("../../helpers/next-mocks")).nextLink);

beforeEach(() => {
  resetNext();
  app = fakeApp({ state: { role: "organiser" } });
});

describe("Sidebar", () => {
  it("lists the links for the signed-in role and who is signed in", () => {
    render(<Sidebar />);

    expect(screen.getByText("My events").closest("a")?.getAttribute("href")).toBe("/my-events");
    expect(screen.getByText("New request")).toBeTruthy();
    expect(screen.getByText("Maya Rahman")).toBeTruthy();
    expect(screen.queryByText("Review queue")).toBeNull();
  });

  it("marks the link for the page you are on", () => {
    navState.pathname = "/new-request";

    render(<Sidebar />);

    expect(screen.getByText("New request").closest("a")?.className).toContain("navItemActive");
    expect(screen.getByText("My events").closest("a")?.className).not.toContain("navItemActive");
  });

  it("signs out", () => {
    render(<Sidebar />);

    fireEvent.click(screen.getByText("Sign out"));

    expect(app.signOut).toHaveBeenCalledTimes(1);
  });
});
