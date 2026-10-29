/*
 * HTTP surface for an existing coding agent, served under /agent/v1/.
 * The Monotes web app proxies /api/agent/v1/* here. Responses are JSON
 * with a single error shape and are never cached.
 */
import { z } from "zod";
import { internal } from "./_generated/api";
import { httpAction, type ActionCtx } from "./_generated/server";
import {
  credentialFileContents,
  generateToken,
  isWellFormedPairingCode,
  isWellFormedToken,
  sha256Hex,
  tokenLabel,
} from "./lib/agentAuth";
import { readBoundedText } from "./lib/boundedBody";
import { MAX_AGENT_BODY_BYTES, MAX_AGENT_EDITS } from "./lib/collabCore";
import type { ApiResult } from "./agentApi";

const NOTE_ID = /^[0-9A-Za-z]{10}$/;
const PREFIX = "/agent/v1/";

const editSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("replace"), old: z.string().min(1), new: z.string() }),
  z.strictObject({ type: z.literal("append"), text: z.string().min(1) }),
]);

const patchSchema = z.strictObject({
  version: z.string().min(1).max(100),
  requestId: z.string().regex(/^[A-Za-z0-9_.:-]{8,100}$/),
  edits: z.array(editSchema).min(1).max(MAX_AGENT_EDITS),
});

function respond({ status, body }: ApiResult, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}

function failure(status: number, code: string, message: string, headers?: Record<string, string>) {
  return respond({ status, body: { error: { code, message } } }, headers);
}

function bearer(request: Request): string | null {
  const header = request.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/.exec(header);
  return match && isWellFormedToken(match[1]) ? match[1] : null;
}

const pairSchema = z.strictObject({ code: z.string().max(100) });
const MAX_PAIR_BODY_BYTES = 1024;

/*
 * Exchange a one-time pairing code for this agent's access file. The key in
 * the file is generated here, stored only as a hash, and returned in this
 * response alone; a used, expired or cancelled code gets nothing.
 */
async function pair(ctx: ActionCtx, request: Request): Promise<Response> {
  const raw = await readBoundedText(request, MAX_PAIR_BODY_BYTES);
  if (raw === null) return failure(413, "body_too_large", "The request body is too large.");
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return failure(400, "invalid_json", 'Send JSON like {"code":"mnp_..."}.');
  }
  const parsed = pairSchema.safeParse(json);
  if (!parsed.success || !isWellFormedPairingCode(parsed.data.code)) {
    return failure(400, "invalid_code", "That isn't a Monotes pairing code. Copy it again from Monotes.");
  }
  const token = generateToken();
  const result = await ctx.runMutation(internal.pairing.redeem, {
    codeHash: await sha256Hex(parsed.data.code),
    tokenHash: await sha256Hex(token),
    tokenPrefix: tokenLabel(token),
  });
  if (!result.ok) {
    if (result.code === "too_many_connections") {
      return failure(409, "too_many_connections", "This Monotes account has too many agent connections. Ask the person to remove one, then try again.");
    }
    if (result.code === "note_unavailable") {
      return failure(410, "note_unavailable", "That note is no longer available for agents. Ask the person for a new code.");
    }
    return failure(404, "invalid_code", "This code was already used, cancelled or expired. Ask the person for a new one in Monotes.");
  }
  const body = credentialFileContents({
    siteOrigin: result.siteOrigin,
    token,
    fileName: result.credentialFile,
    noteId: result.noteId,
  });
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export const agentRequest = httpAction(async (ctx, request) => {
  const url = new URL(request.url);
  if (!url.pathname.startsWith(PREFIX)) return failure(404, "not_found", "Unknown endpoint.");
  const path = url.pathname.slice(PREFIX.length).replace(/\/$/, "").split("/");

  if (path.length === 1 && path[0] === "pair") {
    if (request.method !== "POST") return failure(405, "method_not_allowed", "Use POST with your pairing code.");
    return pair(ctx, request);
  }

  const token = bearer(request);
  if (!token) {
    return failure(401, "unauthorized", "Send your Monotes agent key as: Authorization: Bearer <key>.");
  }
  const auth = await ctx.runMutation(internal.agentApi.authenticate, { tokenHash: await sha256Hex(token) });
  if (!auth.ok) {
    if (auth.code === "rate_limited") {
      return failure(429, "rate_limited", "Too many requests. Wait and try again.", {
        "Retry-After": String(auth.retryAfterSeconds),
      });
    }
    return failure(401, "unauthorized", "This agent key is not valid or was revoked.");
  }
  const connectionId = auth.connectionId;

  if (request.method === "GET" && path.length === 1 && path[0] === "me") {
    return respond(await ctx.runQuery(internal.agentApi.me, { connectionId }));
  }
  if (request.method === "GET" && path.length === 1 && path[0] === "notes") {
    const query = url.searchParams.get("q") ?? undefined;
    if (query && query.length > 200) return failure(400, "invalid_query", "q must be at most 200 characters.");
    const cursor = url.searchParams.get("cursor");
    if (cursor !== null && (cursor.length === 0 || cursor.length > 2000)) {
      return failure(400, "invalid_cursor", "cursor must be a nextCursor value from a previous response.");
    }
    return respond(await ctx.runQuery(internal.agentApi.listNotes, { connectionId, query, cursor }));
  }
  if (path.length === 2 && path[0] === "notes") {
    const noteId = path[1];
    if (!NOTE_ID.test(noteId)) return failure(404, "not_found", "No note with this id is shared with this agent.");
    if (request.method === "GET") {
      return respond(await ctx.runMutation(internal.agentApi.readNote, { connectionId, noteId }));
    }
    if (request.method === "PATCH") {
      const raw = await readBoundedText(request, MAX_AGENT_BODY_BYTES);
      if (raw === null) return failure(413, "body_too_large", "The request body is too large.");
      let json: unknown;
      try {
        json = JSON.parse(raw);
      } catch {
        return failure(400, "invalid_json", "The request body must be JSON.");
      }
      const parsed = patchSchema.safeParse(json);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        const where = issue?.path.length ? ` at ${issue.path.join(".")}` : "";
        return failure(400, "invalid_request", `Invalid edit request${where}: ${issue?.message ?? "unknown problem"}.`);
      }
      const { requestId, version, edits } = parsed.data;
      const payloadHash = await sha256Hex(JSON.stringify({ noteId, version, edits }));
      return respond(
        await ctx.runMutation(internal.agentApi.applyEdits, {
          connectionId,
          noteId,
          requestId,
          payloadHash,
          version,
          edits,
        }),
      );
    }
    return failure(405, "method_not_allowed", "Use GET to read a note or PATCH to edit it.");
  }
  return failure(404, "not_found", "Unknown endpoint.");
});
