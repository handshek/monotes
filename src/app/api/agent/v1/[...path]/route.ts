/*
 * Stable agent API on the Monotes origin: /api/agent/v1/*. See
 * src/lib/agent-proxy.ts for what is forwarded to the backend.
 */
import { forwardAgentRequest } from "@/lib/agent-proxy";

export const dynamic = "force-dynamic";

async function forward(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  return forwardAgentRequest(request, path);
}

export const GET = forward;
export const PATCH = forward;
export const POST = forward;
export const PUT = forward;
export const DELETE = forward;
