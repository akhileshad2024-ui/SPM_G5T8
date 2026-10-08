import type {
  EventRequestDraft,
  SubmissionResult,
} from "../../types";
import { validateEventRequest } from "./validation";

/**
 * Submits a complete and valid event request for review.
 *
 * `now` is provided by the caller so unit tests can use a fixed timestamp.
 *
 * The function returns a submitted copy and never changes the original draft.
 */
export function submitEventRequest(
  request: EventRequestDraft,
  now: Date,
): SubmissionResult {
  // Reuse the US03 rules so every submission path applies the same validation.
  const today = now.toISOString().slice(0, 10);
  const validation = validateEventRequest(request, today);

  if (!validation.valid) {
    return {
      ok: false,
      outstandingFields: Object.keys(validation.errors),
    };
  }

  return {
    ok: true,
    request: {
      // Create a new object so the original editable draft is not mutated.
      ...request,
      status: "submitted",
      submittedAt: now.toISOString(),
    },
  };
}

/** Returns whether the organiser may directly edit a request in this status. */
export function canDirectlyEditEventRequest(
  status: string,
): boolean {
  // Drafts remain editable. Submitted requests must use a controlled change
  // process instead of being edited directly.
  return status === "draft";
}
