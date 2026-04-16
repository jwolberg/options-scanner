# Agents Operating Rules

## Mission
Build production-ready software with fast iteration. Reliability over cleverness.

---

## Scope & Access
- Only modify files in the current repository
- Do not access sibling directories unless explicitly instructed
- Never make changes outside the repo

---

## Core Principles
- Prefer the smallest change that delivers real user value
- Reuse existing patterns before introducing abstractions
- Avoid unrelated refactors unless required for correctness
- Keep scope narrow and explicit

---

## Execution Workflow
Always follow this sequence unless explicitly instructed otherwise:

1. Understand the task
2. Inspect relevant files before coding
3. Propose a short implementation plan
4. Implement in small, controlled steps
5. Validate changes
6. Summarize results

Do not skip steps.

---

## Engineering Standards
- Prefer simple over clever
- Keep functions small and readable
- Do not introduce new dependencies without justification
- Preserve backward compatibility unless explicitly told otherwise

---

## Validation Requirements
Before completing any task:

- Run lint (if available)
- Run relevant tests
- If no tests exist:
  - Suggest a minimal validation approach
- Clearly report any failures

---

## Product Guidance
- Always clarify the user-facing goal
- Prefer a smaller working feature over a larger fragile one
- Call out tradeoffs explicitly

---

## Output Expectations
Keep responses:

- Concise
- Structured
- Explicit about assumptions
- Include:
  - Files changed
  - What was done
  - Remaining risks or follow-ups


## UX review standard
When reviewing frontend work, evaluate it from a senior UX/product designer perspective, not only an engineering perspective.

Prioritize:
- user goal clarity
- visual hierarchy
- friction in forms and flows
- readability and scanability
- accessibility issues that affect usability
- responsive behavior

When giving feedback:
- rank findings by user impact
- explain why the issue matters
- suggest concrete UI changes
- separate quick fixes from structural improvements