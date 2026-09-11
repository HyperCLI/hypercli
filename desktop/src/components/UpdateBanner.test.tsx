import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UpdateBannerCard } from "./UpdateBanner";

const render = (version = "0.3.1") =>
  renderToStaticMarkup(<UpdateBannerCard version={version} onUpdate={() => {}} onDismiss={() => {}} />);

describe("UpdateBannerCard", () => {
  it("renders on the shared issue surface with info styling, not error", () => {
    const html = render();
    expect(html).toContain("error-bar");
    expect(html).toContain("bg-accent-tint");
    expect(html).toContain("border-accent/40");
    expect(html).toContain("text-accent");
    expect(html).not.toContain("bg-error-bg");
    expect(html).not.toContain("border-error/");
    expect(html).not.toContain("text-error");
  });

  it("names the available version and announces itself politely", () => {
    const html = render("1.2.3");
    expect(html).toContain("Update available — HyperCLI v1.2.3");
    expect(html).toContain('role="status"');
  });

  it("wires the install action and the per-version dismiss control", () => {
    const html = render();
    expect(html).toContain("Update and restart");
    expect(html).toContain('aria-label="Dismiss update"');
  });

  it("uses the accent icon and card chrome of the issue surface", () => {
    const html = render();
    expect(html).toContain("lucide-circle-arrow-up");
    expect(html).toContain("pointer-events-auto");
    expect(html).toContain("backdrop-blur-sm");
  });
});
