import { describe, expect, it } from "vitest";
import { formatJobCommandForDisplay } from "./job-command";

describe("formatJobCommandForDisplay", () => {
  it("renders legacy argv commands", () => {
    expect(formatJobCommandForDisplay(["/bin/bash", "-c", "echo hello"])).toBe(
      "/bin/bash -c echo hello",
    );
  });

  it("decodes base64 commands returned by the jobs API", () => {
    expect(formatJobCommandForDisplay(btoa("python app.py --port 8080"))).toBe(
      "python app.py --port 8080",
    );
  });

  it("keeps plain string commands readable", () => {
    expect(formatJobCommandForDisplay("python app.py --port 8080")).toBe(
      "python app.py --port 8080",
    );
  });

  it("hides empty commands", () => {
    expect(formatJobCommandForDisplay(null)).toBe("");
    expect(formatJobCommandForDisplay([])).toBe("");
    expect(formatJobCommandForDisplay("")).toBe("");
  });

  it("hides unexpected API payload shapes", () => {
    expect(formatJobCommandForDisplay({ command: "python app.py" })).toBe("");
  });
});
