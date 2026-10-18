---
name: clean-writing
description: Remove AI-sounding prose and make writing clear, direct, and useful. Use when drafting, editing, or reviewing human-readable writing including docs, plans, PR descriptions, technical design records, RFCs, incident notes, status updates, internal comms, essays, and any text that should sound like a competent person wrote it.
---

# Clean Writing

Make writing useful first, human second, stylish only when it helps.

## Workflow

1. Identify the audience, decision, and expected action.
2. Preserve the user's meaning. Do not invent facts, commitments, dates, owners, metrics, or certainty.
3. Choose the right shape:
   - **Document or plan:** context, goals, non-goals, proposal, risks, next steps.
   - **PR description:** problem, approach, test evidence, rollout or risk.
   - **TRD/RFC:** decision, constraints, alternatives, tradeoffs, migration, validation.
   - **Status update:** current state, change since last update, blockers, asks.
4. Cut AI tells, filler, jargon, false drama, and decorative structure.
5. Make the text scannable with headings, bullets, and tables when they reduce cognitive load.
6. Run the checklist before delivery.

## Editing Rules

- Lead with the point. Put background after the reader knows why it matters.
- Use concrete nouns and active verbs. Name the actor when the actor matters.
- Prefer short sentences for decisions and risks. Use longer sentences only to explain nuance.
- Replace vague claims with observable facts, examples, constraints, or open questions.
- Keep appropriate uncertainty. Say "unknown," "assumption," or "needs validation" when true.
- Remove performance: no throat-clearing, manufactured sincerity, punchline endings, or LinkedIn cadence.
- Avoid em dashes. Use commas, parentheses, colons, or periods.
- Do not over-sanitize personality. Keep useful human voice, especially in PRs and internal docs.

## Reference Files

- Use [references/document-types.md](references/document-types.md) for plans, PRs, TRDs, RFCs, incident notes, and status updates.
- Use [references/phrases.md](references/phrases.md) to remove filler, AI tells, and jargon.
- Use [references/structures.md](references/structures.md) to avoid formulaic sentence and paragraph patterns.
- Use [references/examples.md](references/examples.md) for before and after rewrites.

## Checklist

- Does the first paragraph answer why the reader should care?
- Can the reader tell what changed, what decision is needed, or what happens next?
- Are assumptions, risks, owners, dates, and evidence labeled clearly?
- Did you remove filler phrases and vague intensifiers?
- Did you replace passive voice where the actor matters?
- Did you remove false contrasts like "not X, but Y" unless the contrast carries real meaning?
- Are bullets parallel and useful, not decorative?
- Did you remove em dashes?

## Quality Bar

Deliver text that a busy reviewer can skim, trust, and act on. If the text sounds polished but hides the point, rewrite it. Pretty fog is still fog.
