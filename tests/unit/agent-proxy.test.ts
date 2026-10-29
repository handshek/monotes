// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_BODY_BYTES, forwardAgentRequest } from "../../src/lib/agent-proxy";
import { readBoundedText } from "../../convex/lib/boundedBody";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  process.env.MONOTES_AGENT_API_ORIGIN = "http://backend.test";
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.MONOTES_AGENT_API_ORIGIN;
});

/* A chunked body with no Content-Length; records how much was pulled and whether it was cancelled. */
function chunkedBody(chunkBytes: number, chunks: number) {
  const state = { pulled: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (state.pulled >= chunks) return controller.close();
      state.pulled++;
      controller.enqueue(new Uint8Array(chunkBytes).fill(97));
    },
    cancel() {
      state.cancelled = true;
    },
  });
  return { stream, state };
}

function patchRequest(body: ReadableStream<Uint8Array> | string, headers: Record<string, string> = {}) {
  return new Request("http://monotes.test/api/agent/v1/notes/Note000001", {
    method: "PATCH",
    headers: { Authorization: "Bearer mna_key", "Content-Type": "application/json", ...headers },
    body,
    // Required by Node for streaming request bodies.
    ...({ duplex: "half" } as { duplex: "half" }),
  });
}

describe("agent API proxy", () => {
  it("rejects an oversized chunked body without reading it all or contacting the backend", async () => {
    const { stream, state } = chunkedBody(64 * 1024, 64);
    const response = await forwardAgentRequest(patchRequest(stream), ["notes", "Note000001"]);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ error: { code: "body_too_large" } });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(state.cancelled).toBe(true);
    expect(state.pulled).toBeLessThan(64);
  });

  it("rejects a declared oversized body before reading", async () => {
    const response = await forwardAgentRequest(
      patchRequest("{}", { "Content-Length": String(MAX_BODY_BYTES + 1) }),
      ["notes", "Note000001"],
    );
    expect(response.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards only the key and content type, never cookies, and disables caching", async () => {
    fetchMock.mockResolvedValue(new Response("{\"ok\":true}", { status: 200, headers: { "Content-Type": "application/json", "Set-Cookie": "x=1" } }));
    const response = await forwardAgentRequest(
      patchRequest("{\"a\":1}", { Cookie: "__convexAuthJWT=secret" }),
      ["notes", "Note000001"],
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Set-Cookie")).toBeNull();
    const [target, init] = fetchMock.mock.calls[0];
    expect(String(target)).toBe("http://backend.test/agent/v1/notes/Note000001");
    const sent = new Headers(init?.headers);
    expect(sent.get("Cookie")).toBeNull();
    expect(sent.get("Authorization")).toBe("Bearer mna_key");
    expect(init?.body).toBe("{\"a\":1}");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("answers 504 with resend guidance when the backend times out", async () => {
    fetchMock.mockRejectedValue(new DOMException("timed out", "TimeoutError"));
    const response = await forwardAgentRequest(patchRequest("{}"), ["notes", "Note000001"]);
    expect(response.status).toBe(504);
    expect(await response.json()).toMatchObject({ error: { code: "upstream_timeout" } });
  });

  it("forwards only the search and paging parameters", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    await forwardAgentRequest(
      new Request("http://monotes.test/api/agent/v1/notes?q=plan&cursor=abc%3D&secret=1", { headers: { Authorization: "Bearer mna_key" } }),
      ["notes"],
    );
    expect(String(fetchMock.mock.calls[0][0])).toBe("http://backend.test/agent/v1/notes?q=plan&cursor=abc%3D");
  });

  it("refuses unexpected paths", async () => {
    const response = await forwardAgentRequest(new Request("http://monotes.test/x"), ["..", "secrets"]);
    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("bounded body reader", () => {
  it("returns the text within budget and null beyond it", async () => {
    const small = new Request("http://x.test", { method: "POST", body: "héllo" });
    expect(await readBoundedText(small, 100)).toBe("héllo");
    const { stream, state } = chunkedBody(10, 50);
    const big = new Request("http://x.test", { method: "POST", body: stream, ...({ duplex: "half" } as { duplex: "half" }) });
    expect(await readBoundedText(big, 95)).toBeNull();
    expect(state.cancelled).toBe(true);
  });
});
