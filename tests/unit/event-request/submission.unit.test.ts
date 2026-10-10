import { expect, it } from "vitest";
import { canDirectlyEditEventRequest } from "../../../lib/event-request/submission";

it("shows editing actions only for Draft; API authorisation is tested in Python", () => {
  expect(canDirectlyEditEventRequest("draft")).toBe(true);
  expect(canDirectlyEditEventRequest("submitted")).toBe(false);
});
