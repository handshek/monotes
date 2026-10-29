/*
 * Proxy for the stable agent API on the Monotes origin. Requests are forwarded to the
 * Convex HTTP actions that own every authorization and edit rule. Only the
 * Authorization and Content-Type headers are forwarded: no cookies, no
 * browser session. Responses are never cached.
 */
import { readBoundedText } from "../../convex/lib/boundedBody";

export const MAX_BODY_BYTES = 256 * 1024;
export const UPSTREAM_TIMEOUT_MS = 15_000;
const SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;

function backendOrigin(): string | null {
  const explicit = process.env.MONOTES_AGENT_API_ORIGIN;
  if (explicit) return explicit.replace(/\/$/, "");
  const cloud = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!cloud) return null;
  try {
    const url = new URL(cloud);
    if (!url.hostname.endsWith(".convex.cloud")) return null;
    url.hostname = url.hostname.replace(/\.convex\.cloud$/, ".convex.site");
    return url.origin;
  } catch {
    return null;
  }
}

function failure(status: number, code: string, message: string) {
  return Response.json(
    { error: { code, message } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export async function forwardAgentRequest(request: Request, path: readonly string[]): Promise<Response> {
  const origin = backendOrigin();
  if (!origin) return failure(503, "unavailable", "The agent API isn't configured on this server.");
  if (!path.length || path.length > 3 || !path.every((segment) => SEGMENT.test(segment))) {
    return failure(404, "not_found", "Unknown endpoint.");
  }
  const incoming = new URL(request.url);
  const target = new URL(`${origin}/agent/v1/${path.join("/")}`);
  for (const name of ["q", "cursor"]) {
    const value = incoming.searchParams.get(name);
    if (value !== null) target.searchParams.set(name, value);
  }

  const headers = new Headers();
  const authorization = request.headers.get("Authorization");
  if (authorization) headers.set("Authorization", authorization);
  const contentType = request.headers.get("Content-Type");
  if (contentType) headers.set("Content-Type", contentType);

  let body: string | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    const text = await readBoundedText(request, MAX_BODY_BYTES);
    if (text === null) return failure(413, "body_too_large", "The request body is too large.");
    body = text;
  }

  let response: Response;
  try {
    response = await fetch(target, {
      method: request.method,
      headers,
      body,
      cache: "no-store",
      redirect: "manual",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return failure(
        504,
        "upstream_timeout",
        "Monotes didn't answer in time. Send the same request again unchanged; an edit with the same requestId is applied at most once.",
      );
    }
    return failure(502, "unavailable", "Monotes couldn't reach its backend. Send the same request again shortly.");
  }
  const responseHeaders = new Headers({
    "Content-Type": response.headers.get("Content-Type") ?? "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  const retryAfter = response.headers.get("Retry-After");
  if (retryAfter) responseHeaders.set("Retry-After", retryAfter);
  return new Response(await response.text(), { status: response.status, headers: responseHeaders });
}
