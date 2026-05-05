import { describe, expect, it, vi } from "vitest";

import type { FileEntry } from "../files/types";
import { buildSkillsSnapshotCommand, loadSystemSkills, parseSkillFile, parseSkillSnapshotOutput } from "./workspace-skills";

describe("workspace skills directory", () => {
  it("parses SKILL.md frontmatter and supported subdirectories", () => {
    const skill = parseSkillFile(
      "weather",
      "/app/skills/weather/SKILL.md",
      `---
name: weather
description: "Check current weather and forecasts."
homepage: https://example.com/weather
primaryEnv: WEATHER_API_KEY
metadata:
  {
    "openclaw": {
      "emoji": "sun",
      "requires": { "bins": ["curl"] },
      "install": [{ "brew": "curl" }],
      "os": ["darwin", "linux"]
    }
  }
---
# Weather

Use this skill when weather context is needed.
`,
      [
        { name: "scripts", path: "/app/skills/weather/scripts", type: "directory" },
        { name: "references", path: "/app/skills/weather/references", type: "directory" },
      ],
    );

    expect(skill).toMatchObject({
      id: "weather",
      name: "Weather",
      description: "Check current weather and forecasts.",
      category: "Lookups",
      emoji: "sun",
      homepage: "https://example.com/weather",
      requiresEnv: ["WEATHER_API_KEY"],
      requiresBins: ["curl"],
      os: ["darwin", "linux"],
      frontmatter: expect.stringContaining("name: weather"),
      body: expect.stringContaining("# Weather"),
      content: expect.stringContaining("Use this skill"),
      hasScripts: true,
      hasReferences: true,
      hasAssets: false,
    });
    expect(skill.installHints.length).toBeGreaterThan(0);
  });

  it("discovers flat /app/skills directories and reads each SKILL.md", async () => {
    const listFiles = vi.fn(async (path?: string): Promise<FileEntry[]> => {
      if (path === "/app/skills") {
        return [
          { name: "weather", path: "/app/skills/weather", type: "directory" },
          { name: "github", path: "/app/skills/github", type: "directory" },
        ];
      }
      if (path === "/app/skills/github") {
        return [{ name: "assets", path: "/app/skills/github/assets", type: "directory" }];
      }
      return [];
    });
    const readFile = vi.fn(async (path: string) => (
      path.includes("github")
        ? "---\nname: github\ndescription: GitHub workflows.\n---\n# GitHub"
        : "---\nname: weather\ndescription: Weather lookups.\n---\n# Weather"
    ));

    const skills = await loadSystemSkills(listFiles, readFile);

    expect(readFile).toHaveBeenCalledWith("/app/skills/weather/SKILL.md", "pod");
    expect(readFile).toHaveBeenCalledWith("/app/skills/github/SKILL.md", "pod");
    expect(skills.map((skill) => skill.id)).toEqual(["github", "weather"]);
    expect(skills[0]?.hasAssets).toBe(true);
  });

  it("parses exec snapshot output from /app/skills", () => {
    const skills = parseSkillSnapshotOutput(JSON.stringify([
      {
        id: "github",
        path: "/app/skills/github/SKILL.md",
        content: "---\nname: github\ndescription: GitHub workflows.\n---\n# GitHub",
        entries: [
          { name: "scripts", path: "/app/skills/github/scripts", type: "directory" },
        ],
      },
    ]));

    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      id: "github",
      name: "Github",
      description: "GitHub workflows.",
      category: "Platform",
      hasScripts: true,
    });
    const command = buildSkillsSnapshotCommand();
    expect(command).toContain("/app/skills");
    expect(command).not.toContain("\\n");
  });
});
