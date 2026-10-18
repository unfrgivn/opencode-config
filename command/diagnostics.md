---
description: Run orchestration diagnostics with live delegation probes and task visibility checks
---
Run full diagnostics for orchestration configuration, runtime health, and live delegation verification.

Instructions:

## Phase 1: Tool, Config, Asset & Status Health

1. Check tool availability first:
   - If `fellowship_orchestration` is unavailable, report `FAIL: Tool Unavailable` and stop.
   - Include short remediation steps (install/sync/restart).
2. Call `fellowship_orchestration` with `action="diagnostics"`. The tool output includes config file readability, package/schema health, status/preset state, bundled asset presence, command presence, orchestration config, and runtime state checks.
3. Call `fellowship_orchestration` with `action="tasks"` to capture the pre-probe background job board baseline.

## Phase 2: Live Delegation Probe

4. Run all 4 subagent probes using the `task` tool. Each probe must be trivial, fast, and read-only. Do NOT run destructive or write operations.

   Use the Phase 1 task output to determine available per-session, shared, and provider capacity. Dispatch probes in batches no larger than the currently available capacity. With the default per-session cap of 3 and global cap of 5, dispatch up to 3 probes, wait for them to reach terminal states, then dispatch the remaining probe. If no capacity is available, wait and recheck `action="tasks"` rather than intentionally triggering an admission rejection.

   **Probe A — {{explorer}} (codebase exploration)**:
   - Task: "List the top-level directories and count of files in this repo. Return the directory listing."
   - Expected: completes with a directory listing.

   **Probe B — {{researcher}} (external research)**:
   - Task: "What license does the tmux terminal multiplexer use? Search the web and return the license name (e.g. MIT, BSD, ISC, GPL)."
   - Expected: completes with a license name (ISC).

   **Probe C — {{planner}} (planning)**:
   - Task: "Review this single-sentence plan and identify one risk: 'We will migrate all configs to YAML next sprint.' Return your risk assessment in 2-3 sentences."
   - Expected: completes with a short risk assessment.

   **Probe D — {{implementer}} (implementation worker)**:
   - Task: "Read the file manifest.json in the repo root and return its contents."
   - Expected: completes with JSON content.

5. Wait for every probe in the current batch to complete or fail before dispatching the next batch. Apply a 120-second timeout to each probe and continue until all 4 probes have been attempted.

6. For each probe, record:
   - task_id
   - subagent type
   - status (completed / failed / timed out)
   - round-trip wall time (note when dispatched vs when result returned)
   - whether the result was non-empty and plausible

## Phase 3: Post-Probe Verification

7. Call `fellowship_orchestration` with `action="tasks"` again to verify:
   - All admitted probe tasks appear in the task list.
   - Task statuses are correctly tracked.
   - The Background Job Board summary shows expected counts and aliases.
   - If tmux is enabled, note whether windows were attached/detached during probes.

## Phase 4: Asset Enumeration

8. Enumerate enabled assets:
   - `tools`: list enabled tools, each with a short description.
   - `commands`: use `glob("command/*.md")`; report `/name` + frontmatter description.
   - `agents`: use `glob("agent/*.md")`; report name + frontmatter description.
   - `subagents`: report available Task subagent types + short purpose.
   - `skills`: report available skills + each skill description.
   - `instructions`: read `manifest.json`; include entries and currently loaded AGENTS/instructions visible in session context.

## Phase 5: Report

9. Present the report with these sections in this exact order (even when empty):

   **PASS/WARN/FAIL Findings**
   - All config/runtime checks from Phase 1.
   - Package/schema/status/asset checks from Phase 1.
   - Each probe result as its own PASS/FAIL line.
   - Overall verdict.

   **Runtime Health**
   - Provider mode, shared/provider capacity, cooldowns, loop mode, hooks, and recovery state.

   **Live Delegation Probe Results**
   - Table with columns: Probe, Subagent, Status, Round-Trip, Result Summary.
   - Overall delegation verdict (all passed / partial / all failed).
   - If any probe failed, include the error or timeout details.

   **Delegation & Task Health**
   - Subagent delegation availability (proven by probes, not just config).
   - Total tracked tasks (active + recent), including all admitted probes.
   - Background Job Board count summary and aliases.
   - Active task count.
   - Recent completion/failure/cancel counts.
   - Whether task visibility looks healthy (do all admitted probes show up in `/tasks`?).
   - Tmux window health (attached/missing counts, agent session status if tmux is enabled).

   **Enabled Tools**

   **Enabled Commands**

   **Enabled Agents**

   **Enabled Subagents**

   **Enabled Skills**

   **Enabled Instructions**

10. If any checks or probes fail, include short remediation steps at the end of each relevant section.
