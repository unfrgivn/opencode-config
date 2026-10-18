---
name: reflect
description: Review recent work and repeated OpenCode workflows to recommend reusable skills, commands, agents, config changes, or playbooks. Use when the user asks to reflect on sessions, improve recurring workflows, identify manual patterns, or decide what should become reusable team configuration.
---

# Reflect

Reflect is an evidence-driven workflow for turning repeated friction into the
smallest useful team asset. The output can be a skill, command, agent tweak,
config change, documentation playbook, or a deliberate decision to change
nothing.

Do not manufacture automation because it would be neat. Neat is how we get a
drawer full of cursed knives.

## When to Use

Use this skill when the user asks to:

- reflect on recent work, a project, or a set of OpenCode sessions;
- find workflows they keep repeating manually;
- identify what should become a reusable skill, command, agent, instruction, or
  config default;
- evaluate whether an existing team asset should be changed;
- improve this OpenCode configuration based on actual usage.

Do not use this for ordinary implementation, one-off debugging, generic
architecture review, or speculative agent creation without evidence.

## Core Rules

- Prefer evidence over vibes.
- Inspect existing assets before proposing new ones.
- Recommend the smallest durable form that solves the repeated problem.
- Treat "do nothing" as a valid result when evidence is weak.
- Ask before editing skills, agents, commands, MCPs, prompts, instructions, or
  config files unless the user explicitly asked for those edits.
- Respect privacy boundaries. Do not inspect unrelated personal files,
  credentials, private messages, browser history, or external accounts unless the
  user explicitly asks and the workflow requires it.
- If OpenCode config-time files change, remind the user to restart OpenCode for
  the change to apply.

## Evidence Sources

Use evidence in this order:

1. The current conversation and explicit user requirements.
2. Current repo guidance such as `AGENTS.md`, `.opencode/`, README files,
   project docs, runbooks, and existing codemaps.
3. Existing team and local OpenCode assets: skills, agents, commands,
   instructions, MCP config, plugin config, and presets.
4. Git history, PR notes, issue references, or release notes when they directly
   explain repeated workflow pain.
5. Recent OpenCode session artifacts only when the user asks for session
   archaeology or clearly approves inspecting them.

## Workflow

### 1. Clarify Scope

Identify the reflection target:

- current session;
- a named workflow, such as PR review, release, Jira ticket work, debugging, or
  onboarding;
- a repository or team configuration area;
- recent OpenCode sessions.

If scope is ambiguous, ask one short clarifying question. If the user says to
reflect broadly, start with the current repo and current conversation before
expanding.

### 2. Inventory Existing Assets

Before proposing anything new, check whether the workflow is already covered by:

- bundled skills under `skill/`;
- bundled commands under `command/`;
- agents under `agent/`;
- instructions under `instruction/` and `manifest.json`;
- MCP definitions under `mcp/`;
- project-local `.opencode/` assets;
- relevant README, runbook, codemap, or `AGENTS.md` guidance.

If an existing asset is close, prefer improving it over adding a near-duplicate.

### 3. Find Repeated Patterns

Look for signals such as:

- the same command sequence repeated across tasks;
- the same context-gathering steps repeated before edits;
- repeated test, build, deploy, release, or QA rituals;
- repeated failures caused by missing instructions or unclear ownership;
- repeated specialist routing decisions;
- repeated user corrections that should become stable guidance.

Strong candidates usually have at least two occurrences, stable inputs, a clear
output, and a clear stopping condition.

### 4. Score Candidates

For each candidate, estimate:

- **Frequency:** how often it appears;
- **Cost:** time, context, money, or attention wasted;
- **Risk:** bugs, unsafe changes, bad reviews, or confusing handoffs;
- **Stability:** whether the inputs and desired output are predictable;
- **Coverage:** whether an existing asset already handles it.

Use confidence labels:

- High: repeated, clear, and already backed by evidence;
- Medium: likely useful but needs one more example or a narrower scope;
- Low: one-off, speculative, or too ambiguous to automate.

### 5. Choose the Smallest Useful Form

Use the least powerful asset that solves the problem:

- **Instruction tweak:** a broad team convention or safety rule.
- **Skill:** reusable workflow guidance for a repeated task shape.
- **Command:** stable manual trigger with predictable inputs.
- **Agent:** distinct specialist role with clear routing and boundaries.
- **Config or MCP change:** safe access/model/routing adjustment.
- **Project playbook:** human-readable process that should not be automated yet.
- **No change:** evidence is weak or an existing asset already covers it.

Avoid creating an agent when a skill is enough. Avoid a skill when a short doc
section is enough. Avoid config changes when the benefit is unclear.

### 6. Propose Before Editing

Unless the user explicitly asked for implementation, present the proposal first:

```text
Findings
- <workflow>: evidence, frequency/confidence, current coverage.

Recommended changes
- <asset/config/doc>: smallest useful change and why.

Skipped
- <candidate>: why it is not worth packaging now.

Needs more evidence
- <candidate>: what would make it actionable.
```

When applying changes, keep them narrow, update tests or docs when applicable,
and avoid broad prompt rules that make agents more eager or expensive.

## Session Archaeology Mode

Only use this mode when the user asks to analyze previous sessions.

1. Locate OpenCode session storage for this machine if available. Prefer documented
   config or storage locations over hard-coded paths.
2. Ask before reading broad cross-repo history if the scope was not explicit.
3. Summarize each session with goal, repo, outcome, friction, commands/tools used,
   and confidence.
4. Cache derived summaries only in an appropriate OpenCode or project-owned
   location, never in random personal directories.
5. Aggregate by recurring themes, not by private content.

Report skipped sessions and errors without stopping the whole analysis.

## Output Format

Return a compact report:

```text
Reflection Report

Scope
- <what was reviewed>

Findings
- <pattern>: evidence, frequency, impact, confidence.

Recommended changes
- <asset/config/doc>: purpose, expected benefit, and why this is the smallest useful form.

Skipped
- <candidate>: reason.

Needs more evidence
- <candidate>: what would confirm it.
```

If nothing qualifies, say:

```text
No strong repeated workflow found. I would not add or change reusable assets yet.
```
