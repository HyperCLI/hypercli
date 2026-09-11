import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReadAloudButton } from "./ReadAloudButton";

describe("ReadAloudButton", () => {
  it("is grayed out and disabled when the agent has no voice", () => {
    const html = renderToStaticMarkup(
      <ReadAloudButton hasVoice={false} enabled={false} onToggle={() => {}} />,
    );
    expect(html).toContain('title="Upload audio to have your agent speak"');
    expect(html).toContain("disabled");
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("lucide-volume-x");
    expect(html).not.toContain("text-accent");
  });

  it("stays grayed out and disabled for a voice agent with an empty persisted pref", () => {
    const html = renderToStaticMarkup(
      <ReadAloudButton hasVoice={false} enabled={true} onToggle={() => {}} />,
    );
    expect(html).toContain('title="Upload audio to have your agent speak"');
    expect(html).toContain("disabled");
    expect(html).toContain('aria-pressed="false"');
  });

  it("shows the slashed speaker when voice is configured but read-aloud is off", () => {
    const html = renderToStaticMarkup(
      <ReadAloudButton hasVoice={true} enabled={false} onToggle={() => {}} />,
    );
    expect(html).toContain('title="Read replies aloud"');
    expect(html).not.toMatch(/(<|\s)disabled(=|\s|>)/);
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain("lucide-volume-x");
    expect(html).not.toContain("text-accent");
  });

  it("shows the active speaker when read-aloud is on", () => {
    const html = renderToStaticMarkup(
      <ReadAloudButton hasVoice={true} enabled={true} onToggle={() => {}} />,
    );
    expect(html).toContain('title="Mute voice replies"');
    expect(html).not.toMatch(/(<|\s)disabled(=|\s|>)/);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("lucide-volume-2");
    expect(html).toContain("text-accent");
  });
});
