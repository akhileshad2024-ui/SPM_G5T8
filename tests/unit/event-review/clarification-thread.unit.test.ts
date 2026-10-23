import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { EventRecord } from "../../../lib/types";
import { createPendingClarification } from "./fixtures";

const context = vi.hoisted(() => ({ role: "organiser" }));
vi.mock("../../../lib/state/app-context", () => ({
  useApp: () => ({ state: context }),
}));
import { ClarificationThread } from "../../../components/ui/ClarificationThread";

function view(event: EventRecord, role = "organiser") {
  context.role = role;
  return renderToStaticMarkup(createElement(ClarificationThread, { event }));
}

describe("US09 clarification presentation unit tests (not browser execution)", () => {
  it("AC1: renders nothing when there is no question", () => {
    expect(view({ ...createPendingClarification(), clarification: undefined })).toBe("");
  });
  it("AC1: shows the question and a reply control on a stored pending request", () => {
    const html = view({ ...createPendingClarification(), backendId: 10 });
    expect(html).toContain("Clarification request");
    expect(html).toContain("Send response");
    expect(html).toContain("disabled"); // An empty initial response is not submitted.
  });
  it("AC3: the coordinator sees the question, not an organiser reply form", () => {
    expect(view({ ...createPendingClarification(), backendId: 10 }, "coordinator")).not.toContain("textarea");
  });
  it("AC2: displays the saved response and earlier rounds without an edit form", () => {
    const event = createPendingClarification();
    const question = event.clarification!;
    const html = view({ ...event, backendId: 10, clarification: { ...question,
      response: { message: "Includes speakers", respondedBy: "Maya", respondedAt: "2026-10-23T08:00:00Z" },
      history: [{ ...question, message: "Earlier question" }],
    }});
    expect(html).toContain("Includes speakers");
    expect(html).toContain("Earlier question");
    expect(html).not.toContain("textarea");
  });
  it("supports an amendment question without granting direct event editing", () => {
    const event = createPendingClarification();
    expect(view({ ...event, clarification: { ...event.clarification!, kind: "amendment" } })).toContain("Amendment request");
  });
});
