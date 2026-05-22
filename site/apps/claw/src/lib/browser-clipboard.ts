export async function writeClipboardText(text: string): Promise<boolean> {
  const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;

  if (clipboard?.writeText) {
    try {
      await clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the textarea fallback for browsers or contexts that
      // expose the API but reject the write.
    }
  }

  return copyTextWithTextArea(text);
}

function copyTextWithTextArea(text: string): boolean {
  if (typeof document === "undefined" || typeof document.execCommand !== "function" || !document.body) {
    return false;
  }

  const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const selection = document.getSelection();
  const savedRanges: Range[] = [];

  if (selection) {
    for (let i = 0; i < selection.rangeCount; i += 1) {
      savedRanges.push(selection.getRangeAt(i).cloneRange());
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "-9999px";
  textarea.style.opacity = "0";

  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
    if (selection) {
      selection.removeAllRanges();
      savedRanges.forEach((range) => selection.addRange(range));
    }
    activeElement?.focus();
  }
}
