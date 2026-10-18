# Structures to Avoid

## False Contrasts

Avoid contrast as a reflex:

| Pattern | Better approach |
| --- | --- |
| "Not because X. Because Y." | State Y directly. |
| "X isn't the problem. Y is." | Name the actual problem. |
| "The answer isn't X. It's Y." | State the answer. |
| "It feels like X. It's actually Y." | Explain the evidence. |
| "Not just X, but Y." | Use one precise claim. |

Keep a contrast only when the reader likely believes X and must understand why Y is different.

## Negative Listing

Do not list what something is not before saying what it is:

- "Not a rewrite. Not a redesign. A cleanup."
- "It was not latency. It was not caching. It was queue starvation."

State the point first. Add eliminated causes only when they help the reader trust the diagnosis.

## Passive Voice and Hidden Actors

Passive voice is fine when the actor does not matter. Replace it when it hides responsibility, sequence, or risk.

| Weak | Strong |
| --- | --- |
| "The decision was made" | "The platform team decided" |
| "Errors were introduced" | "The migration introduced errors" |
| "The rollout was paused" | "SRE paused the rollout" |
| "It is believed" | "We believe" or name the team |

## False Agency

Inanimate things rarely act. Name the person, team, system, or mechanism.

| Weak | Strong |
| --- | --- |
| "The data tells us" | "The dashboard shows" or "We infer" |
| "The decision emerged" | "The team decided" |
| "The plan unlocks" | "The plan lets support" |
| "The code wants" | "The code requires" |

## Decorative Structure

Avoid structure that looks polished but adds no information:

- Three-item slogan lists
- Punchline paragraph endings
- Questions answered in the next sentence
- Repeated one-sentence paragraphs
- "Context / Why it matters / What happens next" when the content needs a different shape

Use headings that match the work: **Risk**, **Decision needed**, **Testing**, **Rollback**, **Open questions**.

## Sentence Hygiene

- Avoid em dashes. Use commas, parentheses, colons, or periods.
- Avoid stacked Wh-openers: "What this means," "Why this matters," "How we'll do it."
- Avoid metronomic rhythm. Mix short decision sentences with fuller explanation.
- Keep bullets parallel. Start each bullet with the same kind of thing, such as a verb, noun, or status.
