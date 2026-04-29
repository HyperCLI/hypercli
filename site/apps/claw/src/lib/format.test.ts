import { describe, expect, it } from "vitest";
import {
  formatBurstLine,
  formatCpu,
  formatMemory,
  formatPlanRate,
  formatTokens,
} from "./format";

describe("format helpers", () => {
  it("formats token counts at compact boundaries", () => {
    expect(formatTokens(999)).toBe("999");
    expect(formatTokens(1_000)).toBe("1K");
    expect(formatTokens(1_500)).toBe("1.5K");
    expect(formatTokens(1_000_000)).toBe("1M");
    expect(formatTokens(1_250_000)).toBe("1.3M");
    expect(formatTokens(1_000_000_000)).toBe("1B");
  });

  it("formats plan rate and burst lines", () => {
    const limits = { tpd: 1_000_000, tpm: 100_000, burst_tpm: 250_000, rpm: 600 };

    expect(formatPlanRate(limits)).toBe("1M tokens/day");
    expect(formatBurstLine(limits)).toBe("Up to 250K TPM burst");
  });

  it("formats CPU and memory resources", () => {
    expect(formatCpu(500)).toBe("500m");
    expect(formatCpu(1000)).toBe("1 vCPU");
    expect(formatCpu(1500)).toBe("1.5 vCPU");
    expect(formatMemory(512)).toBe("512 MiB");
    expect(formatMemory(1024)).toBe("1 GiB");
    expect(formatMemory(1536)).toBe("1.5 GiB");
  });
});
