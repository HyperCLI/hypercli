# Claw Agent Context

Use `AGENT-PRIVATE.md` as general local context for Claw app work. Its rules apply in addition to the repo-level and `site/` agent guidance.

## Playwright selector contract

- Treat selectors used by `site/tests/claw` as a public test contract owned by
  the component. When a CI flow needs a durable interaction target, add a
  descriptive `data-testid` to the semantic component or control and use
  Playwright's `getByTestId()`.
- Use stable names such as `agent-empty-history-title`, `agent-chat-composer`,
  and `agent-display-name-edit`. Keep an existing hook stable across wrapper,
  layout, icon, and copy changes unless the underlying behavior is removed.
- Use `getByRole()` when the accessible role/name is itself the behavior being
  verified. Do not use mutable marketing copy as a navigation or interaction
  selector.
- Do not target Tailwind/presentation classes, `div` ancestry, `xpath=..`, or
  positional selectors for CI behavior. A unique semantic HTML `id` is
  acceptable for document relationships such as `aria-labelledby`; prefer a
  `data-testid` for Playwright interaction.
- When refactoring a component used by Playwright, search `site/tests/claw` for
  its existing hooks and update the component and tests in the same commit.
  Reproduce the affected spec against the local live app before changing the
  selector, then rerun that spec after the change.
