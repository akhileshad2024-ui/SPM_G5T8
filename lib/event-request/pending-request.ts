/** UI protection only: ignore extra clicks while the first request is pending. */
export function createPendingRequestGuard() {
  let pending = false;

  return async (action: () => Promise<void>): Promise<void> => {
    // Set the lock synchronously, before React can render the disabled button.
    if (pending) return;
    pending = true;
    try {
      await action();
    } finally {
      // A failed request must not prevent the user from trying again.
      pending = false;
    }
  };
}
