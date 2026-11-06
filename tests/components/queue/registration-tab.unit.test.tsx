// @vitest-environment jsdom
// US32: places taken and the saved registrations on the coordinator's Registration tab.
import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { RegistrationTab } from "../../../components/queue/tabs/RegistrationTab";
import { ApiError } from "../../../lib/api/client";
import { fakeApp } from "../../helpers/fake-app";
import { makeEvent, makeRegistration } from "../../pages/fixtures";

let app = fakeApp();
vi.mock("@/lib/state/app-context", () => ({ useApp: () => app }));
vi.mock("../../../components/queue/ReassessmentPanel", () => ({
  ReassessmentPanel: (p: { eventId: number; kind: string }) => <div>{`reassessment ${p.eventId} ${p.kind}`}</div>,
}));

const open = (overrides = {}) => makeEvent({ reg: true, regCap: 100, registered: 40, ...overrides });

beforeEach(() => { app = fakeApp(); });

it("says registration is disabled and does not ask for registrations", () => {
  render(<RegistrationTab event={makeEvent({ reg: false, registered: 0 })} />);
  expect(screen.getByText("registration disabled")).toBeTruthy();
  expect(screen.getByText("Registration is not enabled for this event.")).toBeTruthy();
});

it("shows places taken out of the cap, then the registrations with a tag per status", async () => {
  app = fakeApp({
    loadRegistrations: vi.fn().mockResolvedValue([
      makeRegistration({ id: "R-1", attendeeName: "Sam Adeyemi", status: "registered" }),
      makeRegistration({ id: "R-2", attendeeName: "Lee Wong", status: "waitlisted" }),
      makeRegistration({ id: "R-3", attendeeName: "Ann Lim", status: "withdrawn" }),
    ]),
  });
  render(<RegistrationTab event={open()} />);
  expect(screen.getByText("40")).toBeTruthy();
  expect(screen.getByText("of 100 places")).toBeTruthy();
  expect(screen.getByText("Loading registrations…")).toBeTruthy();
  expect(await screen.findByText("Sam Adeyemi")).toBeTruthy();
  expect(screen.getByText("Lee Wong")).toBeTruthy();
  expect(screen.getByText("registered")).toBeTruthy();
  expect(screen.getByText("waitlisted")).toBeTruthy();
  expect(screen.getByText("withdrawn")).toBeTruthy();
  expect(app.loadRegistrations).toHaveBeenCalledWith(1);
});

it("says so when nobody has registered", async () => {
  app = fakeApp({ loadRegistrations: vi.fn().mockResolvedValue([]) });
  render(<RegistrationTab event={open({ registered: 0 })} />);
  expect(await screen.findByText("No one has registered yet.")).toBeTruthy();
});

it("explains a 403 and a general failure differently", async () => {
  app = fakeApp({ loadRegistrations: vi.fn().mockRejectedValue(new ApiError(403, "no", {})) });
  const first = render(<RegistrationTab event={open()} />);
  expect(await screen.findByText(/Only the event's organiser and its assigned coordinator/)).toBeTruthy();
  first.unmount();

  app = fakeApp({ loadRegistrations: vi.fn().mockRejectedValue(new Error("offline")) });
  render(<RegistrationTab event={open()} />);
  expect(await screen.findByText("Couldn't load the registrations. Please try again.")).toBeTruthy();
});

it("caps the progress bar at 100% when more people registered than the cap", () => {
  app = fakeApp({ loadRegistrations: vi.fn().mockResolvedValue([]) });
  render(<RegistrationTab event={open({ regCap: 10, registered: 25 })} />);
  expect(screen.getByText("of 10 places")).toBeTruthy();
});

it("shows the reassessment panel only for a stored event", () => {
  app = fakeApp({ loadRegistrations: vi.fn().mockResolvedValue([]) });
  const stored = render(<RegistrationTab event={open({ backendId: 4 })} />);
  expect(screen.getByText("reassessment 4 registration")).toBeTruthy();
  stored.unmount();
  render(<RegistrationTab event={open({ backendId: undefined })} />);
  expect(screen.queryByText(/reassessment/)).toBeNull();
});
