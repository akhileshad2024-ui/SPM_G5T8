/**
 * Thin wrapper around fetch for the FastAPI backend (proxied at /api, see
 * next.config.ts). The session lives in an HttpOnly cookie that the browser
 * attaches automatically — nothing here ever touches the token.
 */

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...init.headers },
  });

  if (!res.ok) {
    let message = res.statusText || "Request failed";
    try {
      const body = await res.json();
      if (typeof body?.detail === "string") message = body.detail;
    } catch {
      // non-JSON error body — keep statusText
    }
    throw new ApiError(res.status, message);
  }

  return (res.status === 204 ? undefined : await res.json()) as T;
}
