// @vitest-environment jsdom
/**
 * components/login/LoginForm.tsx (the sign-in form) and LoginHero.tsx (the branding panel).
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "../../../components/login/LoginForm";
import { LoginHero } from "../../../components/login/LoginHero";
import { STATUS } from "../../../lib/data/options";
import { fakeApp } from "../../helpers/fake-app";

let app = fakeApp();
vi.mock("@/lib/state/app-context", () => ({ useApp: () => app }));

beforeEach(() => {
  app = fakeApp({ state: { authed: false } });
});

const email = () => screen.getByPlaceholderText("you@connectsphere.edu") as HTMLInputElement;
const password = () => screen.getByPlaceholderText("••••••••") as HTMLInputElement;

function type(e: string, p: string) {
  fireEvent.change(email(), { target: { value: e } });
  fireEvent.change(password(), { target: { value: p } });
}

describe("LoginForm", () => {
  it("signs in with the typed email and password", async () => {
    app = fakeApp({ state: { authed: false }, signIn: vi.fn().mockResolvedValue({ ok: true }) });
    render(<LoginForm />);
    type("maya.rahman@connectsphere.edu", "secret-pass");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    });

    expect(app.signIn).toHaveBeenCalledWith("maya.rahman@connectsphere.edu", "secret-pass");
    expect(password().value).toBe("secret-pass");
    expect(document.querySelector(".callout")).toBeNull();
  });

  it("signs in on Enter from either field, but not on other keys", async () => {
    app = fakeApp({ state: { authed: false }, signIn: vi.fn().mockResolvedValue({ ok: true }) });
    render(<LoginForm />);
    type("a@b.c", "pw");

    await act(async () => {
      fireEvent.keyDown(email(), { key: "a" });
    });
    expect(app.signIn).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.keyDown(email(), { key: "Enter" });
    });
    await act(async () => {
      fireEvent.keyDown(password(), { key: "Enter" });
    });
    expect(app.signIn).toHaveBeenCalledTimes(2);
  });

  it("shows the refusal, clears the password, and clears the error once you type again", async () => {
    app = fakeApp({ state: { authed: false }, signIn: vi.fn().mockResolvedValue({ ok: false, error: "Email or password is incorrect." }) });
    render(<LoginForm />);
    type("maya.rahman@connectsphere.edu", "wrong");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    });

    expect(screen.getByText("Email or password is incorrect.")).toBeTruthy();
    expect(password().value).toBe("");

    fireEvent.change(password(), { target: { value: "w" } });
    expect(screen.queryByText("Email or password is incorrect.")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    await act(async () => {});
    fireEvent.change(email(), { target: { value: "x" } });
    expect(screen.queryByText("Email or password is incorrect.")).toBeNull();
  });

  it("shows Signing in… and ignores a second press while signing in", async () => {
    let finish!: (v: { ok: true }) => void;
    app = fakeApp({ state: { authed: false }, signIn: vi.fn(() => new Promise<{ ok: true }>((resolve) => (finish = resolve))) });
    render(<LoginForm />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    });
    expect(screen.getByRole("button", { name: "Signing in…" })).toHaveProperty("disabled", true);
    await act(async () => {
      fireEvent.keyDown(email(), { key: "Enter" });
    });
    expect(app.signIn).toHaveBeenCalledTimes(1);

    await act(async () => finish({ ok: true }));
    expect(screen.getByRole("button", { name: "Sign in" })).toHaveProperty("disabled", false);
  });

  it("shows the sign-in notice (e.g. after a session expired) until there is an error", async () => {
    app = fakeApp({
      state: { authed: false, signInNotice: "Your session expired. Please sign in again." },
      signIn: vi.fn().mockResolvedValue({ ok: false, error: "Email or password is incorrect." }),
    });
    render(<LoginForm />);
    expect(screen.getByText("Your session expired. Please sign in again.")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    });

    expect(screen.queryByText("Your session expired. Please sign in again.")).toBeNull();
    expect(screen.getByText("Email or password is incorrect.")).toBeTruthy();
  });
});

describe("LoginHero", () => {
  it("shows the branding and counts the event statuses from the defined set", () => {
    render(<LoginHero />);

    expect(screen.getByText("One request, one thread, one source of truth.")).toBeTruthy();
    expect(screen.getByText("Event statuses").previousElementSibling?.textContent).toBe(String(Object.keys(STATUS).length));
    expect(screen.getByText("Roles").previousElementSibling?.textContent).toBe("5");
  });
});
