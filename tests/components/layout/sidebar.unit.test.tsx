// @vitest-environment jsdom
/**
 * components/layout/Sidebar.tsx: role-scoped links, the work badges, who is signed in,
 * changing password and signing out.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar } from "../../../components/layout/Sidebar";
import { fakeApp } from "../../helpers/fake-app";
import { navState, resetNext } from "../../helpers/next-mocks";
import { makeBooking, makeEvent } from "../../pages/fixtures";

let app = fakeApp();
vi.mock("@/lib/state/app-context", () => ({ useApp: () => app }));
vi.mock("next/navigation", async () => (await import("../../helpers/next-mocks")).nextNavigation);
vi.mock("next/link", async () => (await import("../../helpers/next-mocks")).nextLink);

beforeEach(() => {
  resetNext();
  app = fakeApp({ state: { role: "organiser" } });
});

const badge = (label: string) => screen.getByText(label).closest("a")?.querySelector("span:nth-child(2)")?.textContent ?? null;

describe("Sidebar", () => {
  it("lists the links for the signed-in role and who is signed in", () => {
    render(<Sidebar />);

    expect(screen.getByText("My events").closest("a")?.getAttribute("href")).toBe("/my-events");
    expect(screen.getByText("New request")).toBeTruthy();
    expect(screen.getByText("Maya Rahman")).toBeTruthy();
    expect(screen.getByText("maya.rahman@connectsphere.edu")).toBeTruthy();
    expect(screen.getByText("MR")).toBeTruthy();
    expect(screen.getByText("Event Organiser")).toBeTruthy();
    expect(screen.queryByText("Review queue")).toBeNull();
  });

  it("marks the link for the page you are on", () => {
    navState.pathname = "/new-request";

    render(<Sidebar />);

    expect(screen.getByText("New request").closest("a")?.className).toContain("navItemActive");
    expect(screen.getByText("My events").closest("a")?.className).not.toContain("navItemActive");
  });

  it("counts the coordinator's work: requests needing action, and nothing on links with no work", () => {
    navState.pathname = "/queue";
    app = fakeApp({
      state: {
        role: "coordinator",
        events: [
          makeEvent({ id: "EVT-1", status: "submitted" }),
          makeEvent({ id: "EVT-2", status: "under_review" }),
          makeEvent({ id: "EVT-3", status: "approved" }),
        ],
      },
    });

    render(<Sidebar />);

    expect(badge("Review queue")).toBe("2");
    // The badge on the page you are on is styled as active too.
    expect(screen.getByText("2").className).toContain("navBadgeActive");
    expect(badge("Pipeline")).toBeNull();
  });

  it("counts pending booking requests across every event for Venue Staff", () => {
    app = fakeApp({
      state: {
        role: "venue",
        events: [
          makeEvent({ id: "EVT-1", bookings: [makeBooking({ id: 1 }), makeBooking({ id: 2, status: "approved" })] }),
          makeEvent({ id: "EVT-2", bookings: [makeBooking({ id: 3 })] }),
          makeEvent({ id: "EVT-3", bookings: undefined }),
        ],
      },
    });

    render(<Sidebar />);

    expect(badge("Booking requests")).toBe("2");
    expect(screen.getByText("2").className).not.toContain("navBadgeActive");
  });

  it("counts equipment requests on approved or confirmed events for Technical Support", () => {
    app = fakeApp({
      state: {
        role: "tech",
        events: [
          makeEvent({ id: "EVT-1", equipState: "requested", status: "approved" }),
          makeEvent({ id: "EVT-2", equipState: "requested", status: "confirmed" }),
          makeEvent({ id: "EVT-3", equipState: "requested", status: "submitted" }),
          makeEvent({ id: "EVT-4", equipState: "reserved", status: "approved" }),
        ],
      },
    });

    render(<Sidebar />);

    expect(badge("Equipment")).toBe("2");
  });

  it("opens and closes the change-password dialog", () => {
    render(<Sidebar />);
    expect(screen.queryByText("Current password")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect(screen.getByText("Current password")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("Current password")).toBeNull();
  });

  it("signs out", () => {
    render(<Sidebar />);

    fireEvent.click(screen.getByText("Sign out"));

    expect(app.signOut).toHaveBeenCalledTimes(1);
  });
});
