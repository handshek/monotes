# How Scribe connects a coding agent

Researched 22 October 2026 from Scribe's public pages, its published skill and its OpenAPI document. I didn't sign in, create a Scribe key, install the skill or run any agent, so none of the connection flow was tested end to end.

## Summary

Scribe's "one command" installs instructions, not a connection. Connecting takes three steps:

1. Install the skill.
2. Create a key in Scribe's settings.
3. Make that key available to the agent as an environment variable.

Scribe then counts an agent as connected only after the key has actually been used. There is no pairing code, OAuth or MCP connection in the public material.

## The flow, step by step

1. **Install the skill.** The homepage presents `npx skills add skeptrunedev/scribe-skill` as "One command teaches your coding agent how to use Scribe" ([homepage](https://scribe.skeptrune.com/)).
   - The [agents guide](https://scribe.skeptrune.com/docs/agents) adds manual steps for Claude Code: create `~/.claude/skills/scribe` and download `skill.md` into it. For other agents it says to place the file wherever that agent loads skills.
   - The installer puts skills in the current project unless `-g` is given. It asks which installed agents to target, names OpenCode, Claude Code, Codex and Cursor among about 80 supported agents, and needs Node.js 22.20 or later. It doesn't handle keys at all ([skills CLI](https://github.com/vercel-labs/skills)).
2. **Create a key.** In Scribe, open **Settings → API keys**, choose **Can edit**, **Can comment** or **Can read**, and copy the `scrb_agt_…` token, which is shown once ([agents guide](https://scribe.skeptrune.com/docs/agents)).
   - The API also accepts an optional name and an expiry of 1–3,650 days. Without one, the key never expires.
   - Organization members with the admin role or higher create keys ([OpenAPI](https://scribe.skeptrune.com/openapi.json), `POST /api/org/api-keys`).
3. **Give the key to the agent.** `export SCRIBE_API_KEY=scrb_agt_…`, kept in a gitignored `.env` or the agent's secret store, "not in a shell profile you keep under version control" ([agents guide](https://scribe.skeptrune.com/docs/agents)). If the variable is unset, the skill tells the agent to stop and ask for a key ([hosted skill](https://scribe.skeptrune.com/skill.md)).
4. **Confirm the connection.** Scribe's onboarding checklist separates two states ([OpenAPI](https://scribe.skeptrune.com/openapi.json), schema `OrgOnboarding`, `GET /api/org/onboarding`):
   - `keyCreated` records key creation, which is insufficient to complete the agent step.
   - `agentConnected` becomes true once a key authenticates a request, using its last-used timestamp as evidence.

## Identity and scope

- **Each key is its own agent.** Every key creates a member-like agent user in the organization. The agent owns the documents it creates, writes comments under its own name, and appears in activity feeds with an agent badge ([agents guide](https://scribe.skeptrune.com/docs/agents); OpenAPI `bearerAuth` and `POST /api/org/api-keys`).
- **Access covers the whole organization, not single documents.** Keys are organization-wide with read, comment or edit access. Documents live in three places:
  - `workspace`, the organization's shared documents;
  - `private`, documents the caller owns;
  - `shared`, documents shared with the caller.

  So an edit key works across all workspace documents. Limiting an agent to particular documents would mean keeping them private and sharing them with the agent's user id, and the spec says agents can only be shared with by id ([OpenAPI](https://scribe.skeptrune.com/openapi.json), `GET /api/docs`, `POST /api/docs/{id}/shares`). I found no per-document key option in the onboarding material.
- **Keys can create keys.** An edit key can create further keys, and those keep working after the original key is revoked. The spec advises auditing them ([OpenAPI](https://scribe.skeptrune.com/openapi.json), `POST /api/org/api-keys`).

## Which agents it works with

The flow needs an agent that can load skill instructions and make HTTP requests, through a shell and `curl` as the skill's examples assume. It also needs the agent to see `SCRIBE_API_KEY`. Claude Code, Cursor "and others" are named ([agents guide](https://scribe.skeptrune.com/docs/agents)). A chat-only assistant without tools isn't covered.

None of the pages say how a desktop app launched outside a terminal receives the environment variable. I didn't test that.

## Inconsistencies and drift

- **The installed skill is out of date.** The installer copies the skill from the GitHub repo, whose README calls itself a mirror of the hosted skill ([skill repo](https://github.com/skeptrunedev/scribe-skill)). That repo has one commit, from 21 July 2026, and its `SKILL.md` (6,023 bytes) differs from the hosted `skill.md` (9,499 bytes) fetched on 22 October 2026. The hosted version adds:
  - an "Always draft in Scribe" rule telling the agent to put plans and drafts into Scribe documents and share the link;
  - folder handling;
  - commenting by exact quoted text.
- **The connection check contradicts the spec.** The hosted skill's quick check calls `GET /api/me` with the key. The spec restricts that endpoint to human sessions and says it rejects API keys.
- **Key management is described two ways.** The skill says key management is session-only. The spec lets edit keys create keys and lets any key list them.

I haven't resolved these without an account.

## What this means for Monotes

- **Ask Scribe's own question.** "Connected" should mean a request was actually made, not that a key exists. This matches what the Monotes prototype aimed for.
- **Scribe's setup isn't simpler in its mechanics.** It has the same three parts the Monotes person found confusing: instructions, a key, and an environment variable. It mainly makes the first part one command, explains the key step in plain terms, and confirms the connection afterwards.
- **Monotes is deliberately narrower.** Scribe's keys are organization-scoped, while Monotes grants access per note. Monotes offers more granular control, with an extra decision for each note.
