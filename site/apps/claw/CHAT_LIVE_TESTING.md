# Claw Chat Live Testing Strategy

Use one running fresh agent and, if available, one older upgraded agent. For each test, capture:

- result
- screenshot or video if broken
- console errors
- network or gateway errors
- whether refresh changes the result

## 0. Preflight

- Open agent chat on desktop.
- Confirm gateway reaches connected/ready state.
- Refresh once before starting.

Expected:

- No stale tool calls.
- No visible internal thinking.
- No empty ghost assistant message.

## 1. Basic Text Chat

Prompt:

```text
Say hello in one short sentence.
```

Expected:

- User message appears immediately.
- Assistant streams or appears cleanly.
- No duplicated response after completion.
- Refresh shows the same visible messages without internal/tool history.

## 2. Streaming Behavior

Prompt:

```text
Write a 5 bullet checklist slowly and clearly.
```

Expected:

- Text grows smoothly.
- No flicker.
- No repeated chunks.
- Final text is coherent.
- Refresh shows the final response only, with no partial duplicate.

## 3. Internal Reasoning Redaction

Prompt:

```text
Think through your answer, but only tell me the final result: what is 19 * 23?
```

Expected:

- No chain-of-thought or internal planning appears.
- Generic waiting/thinking indicator is acceptable.
- Raw phrases like "I need to..." or internal scratchpad text are not acceptable.
- Refresh still shows no reasoning.

## 4. Tool Call Visibility

Prompt:

```text
Look at the workspace files and tell me if there is a README.
```

Expected:

- Tool UI may appear only as compact, user-safe tool status.
- No giant JSON args/results.
- No raw internal file reads.
- No execution logs bleeding into chat.
- Final answer is normal text.
- Refresh does not replay persisted tool calls/results into chat.

## 5. Tool Call Stack

Prompt:

```text
Inspect the project structure and summarize the main folders.
```

Expected:

- Multiple tool calls collapse/stack cleanly.
- Expanding tool UI does not overflow layout.
- Huge result blobs do not appear in the chat body.
- Refresh does not resurrect old tool stacks unless intentionally user-visible.

## 6. Workspace File Attachment

Attach or drop a non-image file into chat, then send:

```text
Use this file and summarize it.
```

Expected:

- File chip appears before send.
- User message shows file chip, not hidden `file: /path` prompt header.
- Agent can reference/use the file.
- Refresh keeps the user-visible file chip sensible.
- Hidden file headers do not leak into chat.

## 7. Image Attachment

Paste, drop, or upload an image, then send:

```text
Describe this image.
```

Expected:

- Thumbnail appears before send.
- User message shows image preview.
- Agent receives image and answers.
- Remove button works before sending.
- Refresh does not break the image preview or render raw base64 text.

## 8. Voice / Audio

Steps:

- Record short audio.
- Preview it.
- Discard once.
- Record and send another audio message.

Expected:

- Recording timer and bars behave.
- Preview play/pause works.
- Discard clears state.
- Sending audio creates a user message without breaking the composer.
- Inline playback appears only when the audio file is available.
- Refresh does not show broken audio UI or raw file paths.

## 9. Markdown Rendering

Prompt:

```text
Return a table, code block, numbered list, and link.
```

Expected:

- Markdown renders cleanly.
- Code blocks wrap or scroll properly.
- Tables do not overflow the chat column.
- On mobile, there is no horizontal page-level overflow.

## 10. Error Handling

Steps:

- Temporarily disconnect network, or use an unavailable/stopped agent.
- Try to send a chat message.
- Reconnect or restart the agent.

Expected:

- Composer disables or shows connection state.
- Sending while disconnected shows a controlled error and does not crash.
- Reconnect recovers without duplicating old messages.

## 11. Refresh / Persistence Regression Pass

After tests 1-10, hard refresh the page.

Expected:

- No tool-call bleed.
- No thinking bleed.
- No duplicated assistant messages.
- No lost visible final answers.

This is the key regression pass.

## 12. Old Upgraded Agent Pass

Repeat tests 1, 4, 6, and refresh on the older upgraded agent.

Expected:

- Workspace and chat work with canonical `main`.
- If legacy UUID files are recovered, files appear without wiping or hiding current workspace content.

## 13. Mobile Pass

Run tests 1, 3, 4, 6, and 7 on mobile width.

Expected:

- Composer is usable.
- Sidebars do not cover chat.
- Attachments and tool UI do not overflow.
- Keyboard does not hide send controls.

## Feedback Format

Use this format for each report:

```text
Test:
Agent: fresh / old-upgraded
Viewport: desktop / mobile
Result: pass / fail
What happened:
Expected:
Console/network errors:
Refresh changed it: yes/no
```
