export const OFFLINE_WORKOUT_SHELL_REQUEST_HEADER = "x-irondesk-offline-shell";
export const OFFLINE_WORKOUT_SHELL_MARKER = "anonymous-workout-shell-v1";

/**
 * Marks only the credential-free, route-correct HTML requested by the service
 * worker as safe to keep for an offline workout reload. Normal navigations,
 * authenticated responses, API responses, and redirects are never marked.
 */
export function markAnonymousOfflineWorkoutShell(request: Request, response: Response): Response {
  const url = new URL(request.url);
  const requestedShell =
    request.method === "GET" &&
    url.pathname === "/workout" &&
    request.headers.get(OFFLINE_WORKOUT_SHELL_REQUEST_HEADER) === OFFLINE_WORKOUT_SHELL_MARKER;
  const credentialFree = !request.headers.has("authorization") && !request.headers.has("cookie");
  const contentType = response.headers.get("content-type") ?? "";
  if (
    !requestedShell ||
    !credentialFree ||
    !response.ok ||
    !contentType.toLowerCase().includes("text/html")
  ) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set(OFFLINE_WORKOUT_SHELL_REQUEST_HEADER, OFFLINE_WORKOUT_SHELL_MARKER);
  // The browser HTTP cache and intermediaries must still treat this as
  // non-cacheable. Only the service worker's private Cache Storage copy is used.
  headers.set("cache-control", "no-store");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
