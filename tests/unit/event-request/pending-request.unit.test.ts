import { expect, it, vi } from "vitest";
import { createPendingRequestGuard } from "../../../lib/event-request/pending-request";

// Technical regression for US05/US06 draft saving, not a new customer AC.
it("ignores repeated clicks until the current save finishes", async () => {
  const guard = createPendingRequestGuard();
  let finishSave!: () => void;
  const request = vi.fn(() => new Promise<void>((resolve) => { finishSave = resolve; }));

  // When three clicks arrive while the first request is still pending...
  const first = guard(request);
  await guard(request);
  await guard(request);
  expect(request).toHaveBeenCalledTimes(1);

  finishSave();
  await first;
  // A later intentional save is allowed; equal content is not forbidden.
  const later = guard(request);
  expect(request).toHaveBeenCalledTimes(2);
  finishSave();
  await later;
});

it("releases the lock after failure so saving can be retried", async () => {
  const guard = createPendingRequestGuard();
  await expect(guard(async () => { throw new Error("Save failed"); })).rejects.toThrow("Save failed");
  const retry = vi.fn(async () => {});
  await guard(retry);
  expect(retry).toHaveBeenCalledTimes(1);
});
