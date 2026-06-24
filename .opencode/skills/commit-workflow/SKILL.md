---
name: commit-workflow
description: Enforce the repository commit workflow. Use when the user says "commit", "prepare commit", "make a commit", "commit this", or asks to commit repository changes.
---

# Commit Workflow

Use this skill whenever the user asks to commit, prepare a commit, or asks what should be committed.

## Default Behavior

- Treat a bare `commit` prompt as a request to prepare and propose a commit, not as permission to run `git commit`.
- Do not run `git commit` unless the user explicitly authorizes the actual commit in the current turn, for example `actually commit this now`, `commit it`, or another unambiguous instruction.
- If the user explicitly asks to commit a Markdown file, that instruction overrides any default non-Markdown staging preference for the named file.
- Never amend, force-push, reset, checkout, or otherwise discard changes unless the user explicitly asks for that exact action.

## Required Checks Before Any Commit Proposal

1. Inspect the worktree with `git status --short`.
2. Inspect unstaged changes with `git diff` for the files in scope.
3. Inspect recent history with `git log --oneline -10`.
4. Identify intended files and unrelated user changes. Do not revert or modify unrelated changes.
5. Stage only intended files. By default, stage non-`.md` files only unless the user explicitly requested Markdown files.
6. Verify the staged set with `git status --short`.
7. Verify staged content with `git diff --cached --stat` and `git diff --cached` or a scoped staged diff.
8. Run `git diff --cached --check`.
9. Check the staged diff for secrets, credentials, debug noise, generated output, and unrelated scope creep.
10. Run the relevant validation gate before proposing commit text.

## HyperCLI Validation Gate

For Claw, main, console, or shared site changes, run:

```bash
npm --prefix site run lint && npm --prefix site run test:claw && npm --prefix site run build
```

For changes outside those areas, run the smallest relevant validation command available from repository docs or package scripts. If no useful validation exists, state that explicitly.

## Commit Proposal Format

When the user has not explicitly authorized running `git commit`, stop after proposing the commit message text.

- Do not use `Title:` or `Description:` labels.
- Provide the exact commit subject line.
- Include a concise body only if useful.
- State that the changes are staged and ready, or explain what remains unstaged.

## If Explicitly Authorized To Commit

Before running `git commit`:

1. Confirm validation passed in the current workflow or explain why it was intentionally skipped.
2. Confirm the staged files are exactly the intended files.
3. Use a concise commit message matching recent repository style.
4. After committing, run `git status --short` and `git log --oneline -1`.
5. Report the commit hash and whether the worktree is clean.

## Safety Rules

- Do not stage secrets, `.env` files, private keys, tokens, build artifacts, or unrelated files.
- Do not stage generated content unless the user explicitly requested generated files and the generator workflow was used.
- Do not use interactive git commands.
- Do not skip hooks or bypass validation unless explicitly instructed.
- If staged content changes unexpectedly or conflicts with user edits, stop and ask how to proceed.

## Restart Note

After adding or editing this skill, tell the user to quit and restart opencode. Skills are loaded at startup, so the running session may not use the new or updated skill until restart.
