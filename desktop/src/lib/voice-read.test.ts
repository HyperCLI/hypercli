import { beforeEach, describe, expect, it } from "vitest";
import {
  flattenForSpeech,
  nextReadAloudEnabled,
  readAloudEnabled,
  setReadAloudEnabled,
  READ_ALOUD_PREF_KEY,
  READ_ALOUD_WORD_CAP,
} from "./voice-read";

describe("flattenForSpeech", () => {
  it("passes plain prose through unchanged", () => {
    expect(flattenForSpeech("The fix is in. Tests pass now.")).toBe("The fix is in. Tests pass now.");
  });

  it("drops fenced code blocks entirely", () => {
    const input = "Here is the change.\n```ts\nconst x = 1;\nconsole.log(x);\n```\nThat is all.";
    expect(flattenForSpeech(input)).toBe("Here is the change. That is all.");
  });

  it("drops unterminated fenced code blocks to the end of the turn", () => {
    const input = "Done, except:\n```\nnever spoken";
    expect(flattenForSpeech(input)).toBe("Done, except:");
  });

  it("drops tilde fences too", () => {
    expect(flattenForSpeech("before ~~~\ncode\n~~~ after")).toBe("before after");
  });

  it("removes inline-code backticks but keeps the inner text", () => {
    expect(flattenForSpeech("Run `npm test` to verify.")).toBe("Run npm test to verify.");
  });

  it("strips header markers", () => {
    expect(flattenForSpeech("## Summary\nIt worked.")).toBe("Summary It worked.");
  });

  it("unwraps bold and italic markers", () => {
    expect(flattenForSpeech("This is **very** good and *quite* fast.")).toBe(
      "This is very good and quite fast.",
    );
  });

  it("unwraps strikethrough and underscore emphasis", () => {
    expect(flattenForSpeech("Not ~~broken~~ _fine_ __now__.")).toBe("Not broken fine now.");
  });

  it("keeps link text and drops the target", () => {
    expect(flattenForSpeech("See [the docs](https://example.com/docs) for details.")).toBe(
      "See the docs for details.",
    );
  });

  it("drops images entirely", () => {
    expect(flattenForSpeech("Look: ![diagram](https://example.com/d.png) neat.")).toBe("Look: neat.");
  });

  it("strips blockquote markers", () => {
    expect(flattenForSpeech("> Quoted words here.")).toBe("Quoted words here.");
  });

  it("strips unordered and ordered list markers", () => {
    expect(flattenForSpeech("- first\n* second\n1. third\n2) fourth")).toBe("first second third fourth");
  });

  it("flattens tables to cell text and drops separator rows", () => {
    const input = "| Name | Value |\n| --- | --- |\n| foo | 42 |";
    expect(flattenForSpeech(input)).toBe("Name Value foo 42");
  });

  it("strips bare URLs", () => {
    expect(flattenForSpeech("Deployed at https://my-agent.hypercli.app right now.")).toBe(
      "Deployed at right now.",
    );
  });

  it("strips file paths but keeps and/or", () => {
    expect(flattenForSpeech("I edited src/components/ChatPane.tsx and /var/log/agent.log and/or config.")).toBe(
      "I edited and and/or config.",
    );
  });

  it("drops quotes and parentheses", () => {
    expect(flattenForSpeech(`The function (exported) returns "ok" — she said 'yes'.`)).toBe(
      "The function exported returns ok, she said yes.",
    );
  });

  it("collapses unicode punctuation into plain sentence spacing", () => {
    expect(flattenForSpeech("Wait… what — really “yes”?!")).toBe("Wait. what, really yes?");
  });

  it("collapses all whitespace", () => {
    expect(flattenForSpeech("one\n\ntwo\t three   four")).toBe("one two three four");
  });

  it("returns empty for empty and whitespace-only input", () => {
    expect(flattenForSpeech("")).toBe("");
    expect(flattenForSpeech("   \n\t  ")).toBe("");
  });

  it("returns empty for a code-only turn", () => {
    expect(flattenForSpeech("```ts\ndoThing();\n```")).toBe("");
  });

  it("caps at the word cap, trailing off at a word boundary without ellipsis", () => {
    const words = Array.from({ length: READ_ALOUD_WORD_CAP + 50 }, (_, i) => `w${i}`);
    const out = flattenForSpeech(words.join(" "));
    const spoken = out.split(" ");
    expect(spoken).toHaveLength(READ_ALOUD_WORD_CAP);
    expect(spoken[READ_ALOUD_WORD_CAP - 1]).toBe(`w${READ_ALOUD_WORD_CAP - 1}`);
    expect(out.endsWith("…")).toBe(false);
    expect(out.endsWith("...")).toBe(false);
  });

  it("trims trailing punctuation left dangling by the word cap", () => {
    const words = Array.from({ length: 10 }, (_, i) => `w${i}`);
    words[4] = "halt,";
    expect(flattenForSpeech(words.join(" "), 5)).toBe("w0 w1 w2 w3 halt");
  });

  it("respects a custom word cap", () => {
    expect(flattenForSpeech("one two three four five", 3)).toBe("one two three");
  });
});

describe("read-aloud preference", () => {
  const storage = new Map<string, string>();
  const store = {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, v),
    removeItem: (k: string) => void storage.delete(k),
  };

  beforeEach(() => storage.clear());

  it("defaults to off", () => {
    expect(readAloudEnabled(store)).toBe(false);
  });

  it("persists on and off under the desktop-ng key", () => {
    setReadAloudEnabled(true, store);
    expect(storage.get(READ_ALOUD_PREF_KEY)).toBe("1");
    expect(readAloudEnabled(store)).toBe(true);
    setReadAloudEnabled(false, store);
    expect(readAloudEnabled(store)).toBe(false);
  });
});

describe("nextReadAloudEnabled (speaker-button toggle policy)", () => {
  it("toggles when the agent has a voice", () => {
    expect(nextReadAloudEnabled(true, false)).toBe(true);
    expect(nextReadAloudEnabled(true, true)).toBe(false);
  });

  it("never toggles when the agent has no voice, whatever the pref says", () => {
    expect(nextReadAloudEnabled(false, false)).toBeNull();
    expect(nextReadAloudEnabled(false, true)).toBeNull();
  });
});
