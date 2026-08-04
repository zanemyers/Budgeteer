export function getCsrfToken(): string {
  const match = document.cookie.match(/csrftoken=([^;]+)/);
  return match ? match[1] : "";
}

/**
 * Turn whatever `jsonFetch` threw into a sentence worth showing the user.
 *
 * It can throw several shapes and they need different handling:
 *  - `{error, status}`   — its own session-expiry signal
 *  - `{field: ["msg"]}`  — Django's `{"errors": {...}}` body, already unwrapped
 *  - `{detail: "msg"}`   — the shape some views use for non-field errors
 *  - a `TypeError`       — `fetch` rejecting because the request never landed
 *
 * Reading only `err.error` (as callers used to) means every validation message is
 * dropped in favour of the fallback, since that key is set on none of the others.
 */
export function errorMessage(err: unknown, fallback: string): string {
  if (typeof err === "string" && err) return err;
  if (err instanceof TypeError) return "Couldn't reach the server. Check your connection and try again.";
  if (err instanceof Error) return err.message || fallback;
  if (err && typeof err === "object") {
    const body = err as Record<string, unknown>;
    if (typeof body.error === "string" && body.error) return body.error;
    if (typeof body.detail === "string" && body.detail) return body.detail;
    // Field errors: surface the first real message rather than "[object Object]".
    for (const value of Object.values(body)) {
      if (typeof value === "string" && value) return value;
      if (Array.isArray(value)) {
        const first = value.find((v) => typeof v === "string" && v);
        if (typeof first === "string") return first;
      }
    }
  }
  return fallback;
}

/**
 * Fetch JSON with CSRF header. Throws the parsed error body on non-OK responses;
 * returns null for 204 No Content; otherwise returns the parsed JSON.
 */
export async function jsonFetch<T = unknown>(url: string, method: string, body?: object): Promise<T | null> {
  const res = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json", "X-CSRFToken": getCsrfToken() },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  // Auto-follow into the login page means the session expired; the response
  // body is HTML and would otherwise blow up at res.json() with a confusing
  // SyntaxError. Surface a structured error so callers can show a clear toast.
  if (res.redirected && /\/accounts\/login\//.test(res.url)) {
    throw { error: "Your session expired. Please reload the page and sign in again.", status: 401 };
  }
  if (!res.ok && res.status !== 204) {
    const data = (await res.json().catch(() => ({}))) as { errors?: unknown };
    throw data.errors ?? data;
  }
  if (res.status === 204) return null;
  return res.json() as Promise<T>;
}
