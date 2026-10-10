/**
 * Thin wrapper around fetch for the FastAPI backend (proxied at /api, see
 * next.config.ts). The session lives in an HttpOnly cookie that the browser
 * attaches automatically — nothing here ever touches the token.
 */

export class ApiError extends Error {
  /** For 422 validation errors: field name -> message (e.g. { cap: "Input should be greater than 0" }). */
  constructor(public status: number, message: string, public fields: Record<string, string> = {}) {
    super(message);
  }
}

interface ValidationIssue {
  loc?: Array<string | number>;
  msg?: string;
}

/** FastAPI 422 bodies list one issue per field; turn them into readable per-field messages. */
function validationFields(detail: ValidationIssue[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of detail) {
    const path = (issue.loc ?? []).filter((p) => p !== "body");
    const key = path.length ? path.join(".") : "_";
    const msg = (issue.msg ?? "Invalid value").replace(/^Value error, /, "");
    fields[key] = fields[key] ? `${fields[key]}; ${msg}` : msg;
  }
  return fields;
}

export async function apiFetch<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", ...init.headers },
  });

  if (!res.ok) {
    let message = res.statusText || "Request failed";
    let fields: Record<string, string> = {};
    try {
      const body = await res.json();
      if (typeof body?.detail === "string") message = body.detail;
      if (Array.isArray(body?.detail)) {
        fields = validationFields(body.detail);
        message = Object.entries(fields)
          .map(([field, msg]) => (field === "_" ? msg : `${field}: ${msg}`))
          .join(" · ");
      }
    } catch {
      // non-JSON error body — keep statusText
    }
    throw new ApiError(res.status, message, fields);
  }

  return (res.status === 204 ? undefined : await res.json()) as T;
}
