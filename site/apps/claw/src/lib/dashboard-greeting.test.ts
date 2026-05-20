import { describe, expect, it } from "vitest";

import {
  displayNameForDashboard,
  displayNameFromEmail,
  greetingForDate,
} from "./dashboard-greeting";

describe("dashboard greeting helpers", () => {
  it("uses profile names before email-derived names", () => {
    expect(displayNameForDashboard({ fullName: "Ada Lovelace", email: "ada@example.com" })).toBe("Ada Lovelace");
    expect(displayNameForDashboard({ name: "Grace Hopper", email: "grace@example.com" })).toBe("Grace Hopper");
    expect(displayNameForDashboard({ username: "compilerfan", email: "user@example.com" })).toBe("compilerfan");
  });

  it("derives a readable name from email when no profile name is available", () => {
    expect(displayNameFromEmail("john.smith+test@example.com")).toBe("John Smith");
    expect(displayNameForDashboard({ email: "maria-garcia@example.com" })).toBe("Maria Garcia");
    expect(displayNameForDashboard(null)).toBe("there");
  });

  it("selects the greeting from the requested timezone", () => {
    expect(greetingForDate(new Date("2026-05-20T09:00:00.000Z"), "UTC")).toBe("Good morning");
    expect(greetingForDate(new Date("2026-05-20T13:00:00.000Z"), "UTC")).toBe("Good afternoon");
    expect(greetingForDate(new Date("2026-05-20T23:00:00.000Z"), "UTC")).toBe("Good evening");
    expect(greetingForDate(new Date("2026-05-20T23:00:00.000Z"), "Pacific/Honolulu")).toBe("Good afternoon");
  });
});
