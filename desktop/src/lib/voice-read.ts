/**
 * Client-side "read the reply aloud" preparation.
 *
 * Two responsibilities, both pure except the thin pref accessors at the
 * bottom:
 *
 * 1. {@link flattenForSpeech} flattens an agent's accumulated reply markdown
 *    into a plain spoken string. No LLM call: fenced code blocks are dropped,
 *    markdown constructs are unwrapped to their visible text, URLs and file
 *    paths are removed, and the result is capped at a word boundary so long
 *    replies simply trail off.
 *
 * 2. The on/off preference, persisted under the app's `desktop-ng-*`
 *    localStorage convention (same shape as update-banner.ts).
 */

export const READ_ALOUD_WORD_CAP = 500;

/** Same naming convention as the pane and theme prefs (`desktop-ng-*`). */
export const READ_ALOUD_PREF_KEY = "desktop-ng-read-aloud";

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Storage can throw on access (blocked cookies in a webview).
    return null;
  }
}

export function readAloudEnabled(storage?: StorageLike | null): boolean {
  const store = storage === undefined ? defaultStorage() : storage;
  try {
    return store?.getItem(READ_ALOUD_PREF_KEY) === "1";
  } catch {
    return false;
  }
}

export function setReadAloudEnabled(enabled: boolean, storage?: StorageLike | null): void {
  const store = storage === undefined ? defaultStorage() : storage;
  try {
    store?.setItem(READ_ALOUD_PREF_KEY, enabled ? "1" : "0");
  } catch {
    // Unwritable storage degrades to session-only toggle state.
  }
}

/**
 * Header speaker-button click policy: the pref flips only when the agent has
 * a voice. Returns the new pref, or null when the click is on the disabled
 * (no-voice) button and must change nothing — renders can race the disabled
 * attribute, so the guard lives here, not only in the DOM.
 */
export function nextReadAloudEnabled(hasVoice: boolean, currentlyEnabled: boolean): boolean | null {
  if (!hasVoice) return null;
  return !currentlyEnabled;
}

/**
 * Flatten reply markdown into speakable prose.
 *
 * Returns "" for empty, whitespace-only, or code-only turns — callers treat
 * that as a no-op (nothing to read).
 */
export function flattenForSpeech(markdown: string, maxWords = READ_ALOUD_WORD_CAP): string {
  if (!markdown || !markdown.trim()) return "";
  let text = markdown;

  // Fenced code blocks — dropped entirely, including an unterminated fence
  // (a turn read mid-stream must not speak code).
  text = text.replace(/```[\s\S]*?(?:```|$)/g, " ");
  text = text.replace(/~~~[\s\S]*?(?:~~~|$)/g, " ");

  // HTML tags: drop the tags, keep any inner text.
  text = text.replace(/<[^>]+>/g, " ");

  // Images dropped entirely; links keep their visible text. Images first so
  // the link rewrite cannot claim the image's alt text.
  text = text.replace(/!\[[^\]]*\]\([^)]*\)/g, " ");
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  text = text.replace(/\[([^\]]*)\]\[[^\]]*\]/g, "$1");

  // URLs before paths, so a URL is never partially eaten by the path rule.
  text = text.replace(/\bhttps?:\/\/\S+/g, " ").replace(/\bwww\.\S+/g, " ");

  // Inline code: backticks removed, inner text kept.
  text = text.replace(/`([^`]*)`/g, "$1");

  // Tables: separator rows vanish, pipes become cell spacing.
  text = text.replace(/^\s*\|?[\s:|-]*-[ \t:|-]*$/gm, " ");
  text = text.replace(/\|/g, " ");

  // Headings, blockquotes, and list markers unwrap to their text.
  text = text.replace(/^\s{0,3}#{1,6}[ \t]+/gm, "");
  text = text.replace(/^[ \t]*>[ \t]?/gm, "");
  text = text.replace(/^[ \t]*(?:[-*+]|\d{1,4}[.)])[ \t]+/gm, "");

  // Emphasis unwraps to its text: bold, italic, strikethrough.
  text = text.replace(/(\*\*|__)([\s\S]*?)\1/g, "$2");
  text = text.replace(/(\*|_)([^*_\n]*?)\1/g, "$2");
  text = text.replace(/~~([\s\S]*?)~~/g, "$1");

  // File paths (heuristic, deliberately simple): a token containing "/" that
  // either ends in an extension or spans at least two separators. "and/or"
  // survives; "src/app/main.ts" and "/usr/lib/node_modules" do not.
  text = text.replace(/[\w.~+-]*\/[\w.~+/\\-]*\.\w{1,10}\b/g, " ");
  text = text.replace(/[\w.~+-]+(?:\/[\w.~+-]+){2,}/g, " ");

  // Punctuation: quotes and parens are dropped, unicode punctuation is
  // normalised to plain sentence spacing.
  text = text.replace(/[“”‘’"'()«»]/g, "");
  text = text.replace(/\s*[…⋮]\s*/g, ". ");
  text = text.replace(/\s*[—–]\s*/g, ", ");
  text = text.replace(/[-_]{2,}/g, " ");
  text = text.replace(/([.!?;,])[.!?;,]+/g, "$1");
  // Detached punctuation (left by dropped URLs/paths) and leading punctuation
  // after a line break read as glitches; drop free-standing runs.
  text = text.replace(/(?:^|\s)[.;:,!?](?=\s|$)/g, " ");

  text = text.replace(/\s+/g, " ").trim();
  if (!text) return "";

  const words = text.split(" ");
  if (words.length > maxWords) {
    // Trail off: cut at a word boundary, no ellipsis, no summary.
    text = words.slice(0, maxWords).join(" ").replace(/[\s,;:]+$/, "");
  }
  return text;
}
