/** UI presentation only; FastAPI enforces editing permission independently. */
export function canDirectlyEditEventRequest(status: string): boolean {
  return status === "draft";
}
