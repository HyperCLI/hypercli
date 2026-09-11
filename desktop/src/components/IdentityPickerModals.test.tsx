import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AgentSummary } from "../api";
import { AvatarPickerModal, IdentityModalShell, VoicePickerModal } from "./IdentityPickerModals";

const agent: AgentSummary = {
  id: "agent-1",
  name: "Penny",
  handle: null,
  avatar_url: null,
  avatar_audio_url: null,
  runtime: "generic",
  state: "RUNNING",
  hostname: null,
  launch_epoch: 0,
  size: null,
};

describe("IdentityModalShell", () => {
  it("renders the drop reminder only while a drag is over it", () => {
    const html = renderToStaticMarkup(
      <IdentityModalShell
        title="Change avatar"
        subtitle="PNG, JPEG, WebP or GIF."
        onClose={() => {}}
        dropLabel="Drop an image to upload"
        onDropFile={() => {}}
      >
        <div />
      </IdentityModalShell>,
    );
    expect(html).not.toContain("Drop an image to upload");
  });
});

describe("AvatarPickerModal", () => {
  it("limits its picker to the image types the avatar routes accept", () => {
    const html = renderToStaticMarkup(
      <AvatarPickerModal agent={agent} onClose={() => {}} onUpload={() => {}} onDelete={() => {}} />,
    );
    expect(html).toContain('aria-label="Change avatar"');
    expect(html).toContain('accept="image/png,image/jpeg,image/webp,image/gif"');
    expect(html).toContain("Choose image");
  });
});

describe("VoicePickerModal", () => {
  it("limits its picker to the audio and video types the voice routes accept", () => {
    const html = renderToStaticMarkup(
      <VoicePickerModal agent={agent} voiceApiUnavailable={false} onClose={() => {}} onUpload={() => {}} onDelete={() => {}} />,
    );
    expect(html).toContain('aria-label="Change voice"');
    expect(html).toContain("audio/*,.mp3,.wav,.m4a,.ogg,.webm,.mp4,video/mp4,video/webm");
    expect(html).toContain("Choose audio");
  });

  it("disables audio selection when the voice routes are absent", () => {
    const html = renderToStaticMarkup(
      <VoicePickerModal agent={agent} voiceApiUnavailable={true} onClose={() => {}} onUpload={() => {}} onDelete={() => {}} />,
    );
    expect(html).toContain("Voice upload is not available in this environment.");
    expect(html).toMatch(/<button[^>]+disabled[^>]*>Choose audio<\/button>/);
  });
});
