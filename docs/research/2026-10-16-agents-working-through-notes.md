# Agents doing work through persistent notes

Official-source check on 2026-10-16. These examples establish documented interactions and vendor positioning, not quality, adoption, or retention. The scenarios and Monotes suggestions below are product hypotheses. No authenticated product workflows were tested.

Baseline before this memo: `/Users/abhi/dev/monotes`, HEAD `21febaf33a3fbf01972fc26a95169dc6edfcfe37`, working tree `?? docs/`. No application files or external accounts were changed.

## Craft: your existing agent works into your documents

**Documented interaction:** Craft's integration guide lets an external assistant read, search, and update a user's Craft documents. The official Imagine gallery shows a recipe where Manus researches a brief and saves structured, cited findings directly into Craft. The same gallery showcases a blog powered by Craft documents and a community lesson-plan-to-slides workflow. The connection is documented functionality; the complete recipes are first-party showcased workflows, not independently tested one-click features. [Connection guide](https://www.craft.do/imagine/guide/mcp/claude), [Imagine gallery](https://www.craft.do/imagine)

**Repeat-use scenario (inference):** A founder maintains one competitor-research note. Each new investigation contributes cited findings to the same record; a client-facing page is generated from selected sections when needed.

**What Monotes could borrow:** Make a note the place an agent delivers completed work. Let selected notes become useful outputs—briefings, comparison tables, or a shareable interactive page—while preserving the underlying material for the next task.

## Notion: a document can carry a recurring job

**Documented interaction:** Custom Agents read permitted pages and databases, run on schedules or events, and take actions including posting reports and updating records. Supported events include a new comment, database changes, or completion of an AI Meeting Note. The help page describes configuring triggers and reviewing activity logs. These are presented as available capabilities, not a roadmap. [Custom Agents help](https://www.notion.com/help/custom-agents)

**Repeat-use scenario (inference):** Each Friday, a project note receives an evidence-backed update: decisions since last week, unresolved blockers, and items needing a person's answer.

**What Monotes could borrow:** Attach a job to a note: “Keep this comparison current,” or “Prepare my Monday briefing from these sources.” The repeated result should improve the user's next action, not merely add more summaries to read.

## Tana: decisions become reviewable actions

**Documented interaction:** Tana's help describes filing issues or updating connected records from a chat or meeting through an action proposal. The user inspects and accepts it; the same card then reports success, partial completion, failure, or a need for input and links to the created result. Meeting context and screenshots can accompany the action. It also documents handing the current document or chat to coding tools such as Codex, Claude Code, and Cursor. [Working with AI](https://tana.inc/help/working-with-ai)

**Repeat-use scenario (inference):** After deciding what to build, a user turns selected notes into issue proposals or a coding-agent brief, then keeps links to the resulting work alongside the original decision.

**What Monotes could borrow:** A visible path from note → proposed action → completed result. “Do this” should leave proof of what happened in the note.

## Mem: research that continues across sessions

**Marketed interaction:** Mem's research-agent page describes retaining questions, sources, prior conclusions, contradictions, and rejected leads, then following up when the work becomes actionable. This is a use-case claim; web research is explicitly qualified by capability availability. Its research page separately describes capture, filing, synthesis, and resurfacing of saved material. [Research with memory](https://get.mem.ai/agent-use-cases/research-with-memory), [Research workspace](https://get.mem.ai/use-cases/research)

**Repeat-use scenario (inference):** A person comparing options over several weeks returns to an updated decision record instead of restarting the search and rediscovering rejected options.

**What Monotes could borrow:** Preserve the state of an investigation: what we know, which evidence supports it, what was ruled out, and the next unanswered question. This is more useful than saving the latest chat answer alone.
