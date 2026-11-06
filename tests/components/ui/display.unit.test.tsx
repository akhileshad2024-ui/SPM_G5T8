// @vitest-environment jsdom
// Shared request-flow indicators: verify displayed state and boundary values.
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Dot } from "../../../components/ui/Dot";
import { ProgressBar } from "../../../components/ui/ProgressBar";
import { WizardSteps } from "../../../components/new-request/WizardSteps";

describe("Request-flow indicators", () => {
  it("renders a dot with default or explicit dimensions", () => {
    const { container, rerender } = render(<Dot color="red" />);
    const dot = container.querySelector("span")!;
    expect(dot.style.width).toBe("8px");
    expect(dot.style.height).toBe("8px");
    expect(dot.style.background).toBe("red");
    rerender(<Dot color="blue" size={12} />);
    expect(dot.style.width).toBe("12px");
    expect(dot.style.height).toBe("12px");
    expect(dot.style.background).toBe("blue");
  });

  it.each([[-5, "0%"], [40, "40%"], [130, "100%"]])("clamps progress %s to %s", (pct, width) => {
    const { container } = render(<ProgressBar pct={pct} />);
    expect(container.querySelector<HTMLElement>(".progress-fill")!.style.width).toBe(width);
    expect(container.querySelector(".progress-track-thin")).toBeNull();
  });

  it("renders the thin progress variant with the supplied colour", () => {
    const { container } = render(<ProgressBar pct={70} color="red" thin />);
    expect(container.querySelector(".progress-track-thin")).toBeTruthy();
    expect(container.querySelector<HTMLElement>(".progress-fill")!.style.background).toBe("red");
  });

  it.each([1, 2, 3] as const)("marks wizard step %s active and earlier steps complete", step => {
    const { container } = render(<WizardSteps step={step} />);
    const rows = Array.from(container.firstElementChild!.children);
    expect(rows.map(row => row.textContent)).toEqual(["1Basics", "2Requirements", "3Registration"]);
    rows.forEach((row, index) => {
      expect(row.className.includes("stepActive")).toBe(index + 1 === step);
      expect(row.querySelector("span")!.className.includes("stepNumberDone")).toBe(index + 1 < step);
    });
  });
});
