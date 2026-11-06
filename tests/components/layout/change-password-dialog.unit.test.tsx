// @vitest-environment jsdom
/**
 * components/layout/ChangePasswordDialog.tsx: checks the three fields before sending, sends the change,
 * and shows the server's refusal (wrong password, too many tries) in the dialog. Any other error goes to
 * the app's handler, and a lapsed session (401) closes the dialog.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChangePasswordDialog } from "../../../components/layout/ChangePasswordDialog";
import { ApiError } from "../../../lib/api/client";
import { fakeApp } from "../../helpers/fake-app";

const apiFetch = vi.fn();
vi.mock("@/lib/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/client")>()),
  apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

let app = fakeApp();
vi.mock("@/lib/state/app-context", () => ({ useApp: () => app }));

let onClose = vi.fn();

beforeEach(() => {
  apiFetch.mockReset();
  app = fakeApp({ state: { role: "organiser" } });
  onClose = vi.fn();
});

const input = (label: string) => screen.getByText(label).parentElement!.querySelector("input")!;

function fill(current: string, next: string, confirm = next) {
  fireEvent.change(input("Current password"), { target: { value: current } });
  fireEvent.change(input("New password"), { target: { value: next } });
  fireEvent.change(input("Confirm new password"), { target: { value: confirm } });
}

async function submit() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
  });
}

describe("ChangePasswordDialog", () => {
  it("carries the signed-in email for password managers", () => {
    const { container } = render(<ChangePasswordDialog onClose={onClose} />);
    expect((container.querySelector('input[type="email"]') as HTMLInputElement).value).toBe("maya.rahman@connectsphere.edu");
  });

  it.each([
    ["", "longenough", "longenough", "Enter your current password."],
    ["old-password", "short", "short", "New password must be at least 8 characters."],
    ["old-password", "longenough", "different1", "New passwords don't match."],
    ["same-password", "same-password", "same-password", "New password must be different from the current one."],
  ])("refuses current=%j new=%j confirm=%j without calling the server", async (current, next, confirm, message) => {
    render(<ChangePasswordDialog onClose={onClose} />);
    fill(current, next, confirm);

    await submit();

    expect(screen.getByText(message)).toBeTruthy();
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("clears the error as soon as a field is edited", async () => {
    render(<ChangePasswordDialog onClose={onClose} />);
    await submit();
    expect(screen.getByText("Enter your current password.")).toBeTruthy();

    fireEvent.change(input("Current password"), { target: { value: "x" } });

    expect(screen.queryByText("Enter your current password.")).toBeNull();
  });

  it("changes the password, tells the user, and closes", async () => {
    apiFetch.mockResolvedValue({});
    render(<ChangePasswordDialog onClose={onClose} />);
    fill("old-password", "new-password");

    await submit();

    expect(apiFetch).toHaveBeenCalledWith("/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ current_password: "old-password", new_password: "new-password" }),
    });
    expect(app.flash).toHaveBeenCalledWith("Password changed. You've been signed out on other devices.");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows Saving… and ignores a second submit while the first is in flight", async () => {
    let finish!: () => void;
    apiFetch.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    const { container } = render(<ChangePasswordDialog onClose={onClose} />);
    fill("old-password", "new-password");

    await submit();
    expect(screen.getByRole("button", { name: "Saving…" })).toHaveProperty("disabled", true);
    await act(async () => {
      fireEvent.submit(container.querySelector("form")!);
    });
    expect(apiFetch).toHaveBeenCalledTimes(1);

    await act(async () => finish());
    expect(screen.getByRole("button", { name: "Change password" })).toHaveProperty("disabled", false);
  });

  it.each([400, 429])("shows the server's %i refusal and clears the current password", async (status) => {
    apiFetch.mockRejectedValue(new ApiError(status, "Current password is incorrect."));
    render(<ChangePasswordDialog onClose={onClose} />);
    fill("wrong-password", "new-password");

    await submit();

    expect(screen.getByText("Current password is incorrect.")).toBeTruthy();
    expect(input("Current password").value).toBe("");
    expect(app.handleApiError).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("hands a lapsed session (401) to the app and closes", async () => {
    const err = new ApiError(401, "Your session has expired.");
    apiFetch.mockRejectedValue(err);
    render(<ChangePasswordDialog onClose={onClose} />);
    fill("old-password", "new-password");

    await submit();

    expect(app.handleApiError).toHaveBeenCalledWith(err);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a server error", new ApiError(500, "Server error")],
    ["a network failure", new Error("Failed to fetch")],
  ])("hands %s to the app and stays open", async (_, err) => {
    apiFetch.mockRejectedValue(err);
    render(<ChangePasswordDialog onClose={onClose} />);
    fill("old-password", "new-password");

    await submit();

    expect(app.handleApiError).toHaveBeenCalledWith(err);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes from Cancel or the backdrop, but not from a click inside the form", () => {
    const { container } = render(<ChangePasswordDialog onClose={onClose} />);

    fireEvent.click(container.querySelector("form")!);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(container.firstChild as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
