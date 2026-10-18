# Document Types

Use these shapes when the user asks for a draft, rewrite, or review.

## Plans

Prefer this order:

1. Goal
2. Current state
3. Proposed approach
4. Scope and non-goals
5. Risks and mitigations
6. Open questions
7. Next steps with owners or dates when known

Keep plans human-readable. If a section has no useful content, remove it instead of leaving a placeholder.

## PR Descriptions

Use this structure unless the repo has a template:

```markdown
## Summary
- <what changed and why>

## Testing
- <command or manual check>

## Risk
- <rollout note, known risk, or "Low, <reason>">
```

Avoid dumping implementation detail into the summary. Reviewers need the intent, the risky areas, and the evidence.

## TRDs and RFCs

Make decisions reviewable:

1. Problem
2. Goals and non-goals
3. Constraints
4. Proposal
5. Alternatives considered
6. Tradeoffs
7. Migration or rollout
8. Validation plan
9. Open questions

Use direct labels for uncertainty: **Assumption**, **Risk**, **Open question**, **Decision needed**.

## Incident Notes

Prioritize sequence and accountability over prose polish:

1. Impact
2. Timeline
3. Root cause or current hypothesis
4. Mitigation
5. Follow-ups

Do not soften failure language. Do not assign blame unless the facts require it.

## Status Updates

Answer four questions:

- What changed since the last update?
- What is blocked?
- What decision or help is needed?
- What happens next?

Keep optimism out of the way. Evidence beats vibes.
