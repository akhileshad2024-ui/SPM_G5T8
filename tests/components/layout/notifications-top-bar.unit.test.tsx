// @vitest-environment jsdom
/**
 * components/layout/TopBar.tsx and NotificationsPanel.tsx: the page title, the unread count for your role,
 * and the panel of your role's notifications.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationsPanel } from "../../../components/layout/NotificationsPanel";
import { TopBar } from "../../../components/layout/TopBar";
import { fakeApp } from "../../helpers/fake-app";
import { navState, resetNext } from "../../helpers/next-mocks";
import { makeNotif } from "../../pages/fixtures";

let app = fakeApp();
vi.mock("@/lib/state/app-context", () => ({ useApp: () => app }));
vi.mock("next/navigation", async () => (await import("../../helpers/next-mocks")).nextNavigation);

beforeEach(() => {
  resetNext();
  app = fakeApp();
});

describe("TopBar", () => {
  it("shows the page's title and counts only this role's unread notifications", () => {
    navState.pathname = "/queue";
    app = fakeApp({
      state: {
        notifs: [
          makeNotif({ id: 1 }),
          makeNotif({ id: 2 }),
          makeNotif({ id: 3, read: true }),
          makeNotif({ id: 4, to: "organiser" }),
        ],
      },
    });

    render(<TopBar />);

    expect(screen.getByText("Review queue")).toBeTruthy();
    expect(screen.getByRole("button").textContent).toBe("Notifications2");
    expect(screen.queryByText("Mark all read")).toBeNull();
  });

  it("shows no count when everything is read, and toggles the panel", () => {
    app = fakeApp({ state: { notifs: [makeNotif({ read: true })] } });

    render(<TopBar />);
    expect(screen.getByRole("button").textContent).toBe("Notifications");
    fireEvent.click(screen.getByRole("button"));

    expect(app.toggleNotifs).toHaveBeenCalledTimes(1);
  });

  it("shows the panel while it is open", () => {
    app = fakeApp({ state: { notifsOpen: true } });

    render(<TopBar />);

    expect(screen.getByText("Mark all read")).toBeTruthy();
  });
});

describe("NotificationsPanel", () => {
  it("lists this role's notifications with their actions", () => {
    app = fakeApp({
      state: {
        notifs: [
          makeNotif({ id: 1, title: "Assigned to you", eventId: 7, eventName: "Career Fair" }),
          makeNotif({ id: 2, title: "Old news", read: true }),
          makeNotif({ id: 3, title: "For the organiser", to: "organiser" }),
        ],
      },
    });

    render(<NotificationsPanel />);

    expect(screen.getByText("Assigned to you")).toBeTruthy();
    expect(screen.getByText("Career Fair")).toBeTruthy();
    expect(screen.getByText("Old news")).toBeTruthy();
    expect(screen.queryByText("For the organiser")).toBeNull();
    // Only the event-linked one can be opened, and only the unread one marked read.
    expect(screen.getAllByText("Open event")).toHaveLength(1);
    expect(screen.getAllByText("Mark as read")).toHaveLength(1);
    expect(screen.queryByText("Show older")).toBeNull();

    fireEvent.click(screen.getByText("Open event"));
    fireEvent.click(screen.getByText("Mark as read"));
    fireEvent.click(screen.getByText("Mark all read"));

    expect(app.openNotification).toHaveBeenCalledWith(1);
    expect(app.markRead).toHaveBeenCalledWith(1);
    expect(app.markAllRead).toHaveBeenCalledTimes(1);
  });

  it("says so when there is nothing for this role, and offers older ones", () => {
    app = fakeApp({ state: { notifs: [makeNotif({ to: "venue" })], olderNotifs: true } });

    render(<NotificationsPanel />);

    expect(screen.getByText("Nothing yet for this role.")).toBeTruthy();
    fireEvent.click(screen.getByText("Show older"));
    expect(app.loadOlderNotifs).toHaveBeenCalledTimes(1);
  });
});
