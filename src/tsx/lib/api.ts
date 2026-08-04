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
    // Field errors: `{field: ["msg", ...]}`. Every message is joined rather than just the
    // first, so a form with several invalid fields reports all of them — and rather than
    // "[object Object]", which is what naive stringifying produced.
    const messages = Object.values(body).flatMap((value) => {
      if (typeof value === "string" && value) return [value];
      if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && !!item);
      return [];
    });
    if (messages.length > 0) return messages.join(" ");
  }
  return fallback;
}

/**
 * Normalise a thrown value into the `{field: ["msg"]}` map that form components render.
 *
 * A field-error body passes through untouched. Anything else — a session expiry, a network
 * failure, an HTML error page — is put under `non_field_errors` so the form still shows
 * something. Without that, a form reading `errors.non_field_errors` renders nothing at all
 * for exactly those cases and just silently re-enables its submit button.
 */
export function fieldErrors(err: unknown, fallback = "Something went wrong."): Record<string, string[]> {
  if (err && typeof err === "object" && !(err instanceof Error)) {
    const body = err as Record<string, unknown>;
    const isFieldMap = Object.values(body).some(
      (value) => Array.isArray(value) && value.every((item) => typeof item === "string"),
    );
    if (isFieldMap) return body as Record<string, string[]>;
  }
  return { non_field_errors: [errorMessage(err, fallback)] };
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
