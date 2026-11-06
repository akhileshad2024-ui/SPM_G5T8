// @vitest-environment jsdom
/**
 * components/Modal.tsx (the shared confirm/reason dialog) and components/Toast.tsx (the short banner).
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Modal } from "../../components/Modal";
import { Toast } from "../../components/Toast";
import type { ModalState } from "../../lib/types";
import { fakeApp } from "../helpers/fake-app";

let app = fakeApp();
vi.mock("@/lib/state/app-context", () => ({ useApp: () => app }));

beforeEach(() => {
  app = fakeApp();
});

const modal = (kind: ModalState["kind"]): ModalState => ({
  kind,
  id: "EVT-1",
  title: "Request clarification",
  body: "Ask the organiser for more detail.",
  label: "Message",
  placeholder: "What do you need?",
  confirm: "Send",
});

describe("Modal", () => {
  it("shows nothing when no dialog is open", () => {
    const { container } = render(<Modal />);
    expect(container.innerHTML).toBe("");
  });

  it("shows the dialog, passes on typing, and confirms or cancels", () => {
    app = fakeApp({ state: { modal: modal("clarify"), modalText: "Which room?" } });
    render(<Modal />);

    expect(screen.getByText("Request clarification")).toBeTruthy();
    expect(screen.getByText("Ask the organiser for more detail.")).toBeTruthy();
    expect(screen.getByText("Message")).toBeTruthy();
    const box = screen.getByPlaceholderText("What do you need?") as HTMLTextAreaElement;
    expect(box.value).toBe("Which room?");

    fireEvent.change(box, { target: { value: "Which room and time?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(app.setModalText).toHaveBeenCalledWith("Which room and time?");
    expect(app.confirmModal).toHaveBeenCalledTimes(1);
    expect(app.closeModal).toHaveBeenCalledTimes(1);
  });

  it("closes from the backdrop but not from a click inside the dialog", () => {
    app = fakeApp({ state: { modal: modal("clarify") } });
    const { container } = render(<Modal />);

    fireEvent.click(screen.getByText("Request clarification"));
    expect(app.closeModal).not.toHaveBeenCalled();

    fireEvent.click(container.firstChild as HTMLElement);
    expect(app.closeModal).toHaveBeenCalledTimes(1);
  });

  it("locks a change-request dialog while one is being sent", () => {
    app = fakeApp({ state: { modal: modal("change") }, changeRequestPending: true });
    render(<Modal />);

    expect(screen.getByRole("textbox")).toHaveProperty("disabled", true);
    expect(screen.getByRole("button", { name: "Send" })).toHaveProperty("disabled", true);
  });

  it("does not lock other dialogs while a change request is being sent", () => {
    app = fakeApp({ state: { modal: modal("clarify") }, changeRequestPending: true });
    render(<Modal />);

    expect(screen.getByRole("textbox")).toHaveProperty("disabled", false);
    expect(screen.getByRole("button", { name: "Send" })).toHaveProperty("disabled", false);
  });
});

describe("Toast", () => {
  it("shows nothing when there is no message", () => {
    const { container } = render(<Toast />);
    expect(container.innerHTML).toBe("");
  });

  it.each([
    ["ok", "rgb(46, 200, 255)"],
    ["warn", "rgb(255, 191, 0)"],
    ["bad", "rgb(255, 77, 94)"],
    ["unknown", "rgb(46, 200, 255)"],
  ])("shows the message with the %s colour", (kind, colour) => {
    app = fakeApp({ state: { toast: "Draft saved.", toastKind: kind as "ok" } });
    const { container } = render(<Toast />);

    expect(screen.getByText("Draft saved.")).toBeTruthy();
    expect(container.innerHTML).toContain(colour);
  });
});
