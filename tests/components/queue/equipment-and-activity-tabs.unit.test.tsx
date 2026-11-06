// @vitest-environment jsdom
// The coordinator's Equipment and Activity tabs of one event.
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ActivityTab } from "../../../components/queue/tabs/ActivityTab";
import { EquipmentTab } from "../../../components/queue/tabs/EquipmentTab";
import { makeEvent } from "../../pages/fixtures";

vi.mock("@/components/equipment/EquipmentManager", () => ({
  EquipmentManager: (props: { eventId: number; coordinator?: boolean }) => (
    <div data-testid="manager">{`manager ${props.eventId} ${props.coordinator ? "coordinator" : "other"}`}</div>
  ),
}));
vi.mock("../../../components/queue/EventDetailHistory", () => ({ EventDetailHistory: () => <div>detail history</div> }));
vi.mock("@/components/ui/StatusHistory", () => ({ StatusHistory: () => <div>status history</div> }));

it("asks to save the event first when it has no stored id", () => {
  render(<EquipmentTab event={makeEvent({ backendId: undefined })} />);
  expect(screen.getByText("Save this event before recording equipment.")).toBeTruthy();
  expect(screen.queryByTestId("manager")).toBeNull();
});

it("manages equipment as the coordinator for a stored event", () => {
  render(<EquipmentTab event={makeEvent({ backendId: 9 })} />);
  expect(screen.getByTestId("manager").textContent).toBe("manager 9 coordinator");
});

it("shows the detail history, the status history and the activity timeline", () => {
  const event = makeEvent({
    activity: [
      { title: "Request submitted", when: "Mon 09:00", body: "Maya sent it." },
      { title: "Coordinator assigned", when: "Mon 10:00", body: "Priya Tan took it." },
    ] as never,
  });
  const { container } = render(<ActivityTab event={event} />);
  expect(screen.getByText("detail history")).toBeTruthy();
  expect(screen.getByText("status history")).toBeTruthy();
  expect(screen.getByText("Status history")).toBeTruthy();
  expect(screen.getByText("Request submitted")).toBeTruthy();
  expect(screen.getByText("Priya Tan took it.")).toBeTruthy();
  // The newest entry has a blue marker; the last entry's connecting line is transparent.
  const dots = container.querySelectorAll<HTMLElement>(".dot");
  expect(dots[0].style.background).toContain("var(--blue)");
  expect(dots[1].style.background).not.toContain("var(--blue)");
  const lines = [...container.querySelectorAll<HTMLElement>("span")].filter((s) => s.style.width === "1px");
  expect(lines[0].style.background).not.toBe("transparent");
  expect(lines[1].style.background).toBe("transparent");
});

it("shows no timeline entries for an event with no activity", () => {
  render(<ActivityTab event={makeEvent({ activity: [] })} />);
  expect(screen.queryByText("Request submitted")).toBeNull();
});
