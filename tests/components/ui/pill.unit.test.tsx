// @vitest-environment jsdom
/**
 * Example component test (the simplest shape): render, assert on what the user sees.
 * Copy this file's structure for a new component. components/ui/Pill.tsx.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusPill, Tag } from "../../../components/ui/Pill";
import type { EventStatus } from "../../../lib/types";

describe("StatusPill", () => {
  it("shows the status's label", () => {
    render(<StatusPill status="under_review" />);

    expect(screen.getByText("Under Review")).toBeTruthy();
  });

  it("falls back to the draft pill for a status it doesn't know", () => {
    render(<StatusPill status={"mystery" as EventStatus} />);

    expect(screen.getByText("Draft")).toBeTruthy();
  });
});

describe("Tag", () => {
  it("shows its label with the default colours and no border", () => {
    render(<Tag label="PA system" />);

    const tag = screen.getByText("PA system");
    expect(tag.style.color).not.toBe("");
    expect(tag.style.border).toBe("");
  });

  it("uses the colours and border it is given", () => {
    render(<Tag label="Step-free" bg="#ffffff" fg="#000000" border="#ff0000" />);

    expect(screen.getByText("Step-free").style.border).toContain("1px solid");
  });
});
