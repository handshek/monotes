# Monotes

## UI
Build UI with Sodium: follow `.agents/skills/sodium/SKILL.md` and its components in `src/components/sodium/`.

One override to Sodium: every type role is set in Commit Mono, not Inter Display. Notes are edited with Vim, whose motions, block selections and block cursor need equal-width characters, and the rest of the app matches the editor. Keep using the type roles (`type-title`, `type-body`, `type-label`, ...); `--font-sans` in `src/components/sodium/tokens.css` carries the mono stack. Never add a sans or proportional face.

Before finishing UI work, run `bun run lint:sodium`, `bun run lint` and `bun run typecheck`.
