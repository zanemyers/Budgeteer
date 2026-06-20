export function getCsrfToken(): string {
  const match = document.cookie.match(/csrftoken=([^;]+)/);
  return match ? match[1] : "";
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
  if (!res.ok && res.status !== 204) {
    const data = await res.json().catch(() => ({})) as { errors?: unknown };
    throw data.errors ?? data;
  }
  if (res.status === 204) return null;
  return res.json() as Promise<T>;
}
