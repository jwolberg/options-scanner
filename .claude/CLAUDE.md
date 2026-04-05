# Project Operating Rules

## Mission
We build production-ready software with fast iteration, but reliability matters more than cleverness.

## Access Rules
- Only modify files in the current project
- Do not access sibling directories unless explicitly instructed
- Never make changes outside the current repo

## Workflow
Always follow this sequence unless explicitly told otherwise:
1. Understand the task
2. Inspect relevant files
3. Propose a brief plan
4. Implement in small steps
5. Run validation
6. Summarize what changed and what remains

## Engineering standards
- Prefer simple solutions over clever abstractions
- Reuse existing patterns in the codebase
- Keep functions focused and readable
- Do not introduce new dependencies unless justified
- Preserve backward compatibility unless told otherwise

## Validation
Before considering work complete:
- Run lint
- Run tests relevant to changed files
- If no tests exist, suggest a minimal test or validation path
- Report failures clearly

## Product behavior
- Clarify the user-facing goal of every feature
- Prefer shipping a narrower working version over a broader fragile one
- Call out tradeoffs when making implementation choices

## Output style
- Be concise
- State assumptions
- List changed files
- Note risks / follow-ups