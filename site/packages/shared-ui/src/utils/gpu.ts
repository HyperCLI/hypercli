export const GPU_INFO: Record<string, { vram: string; arch: string; displayName: string }> = {
  B300: { vram: "260GB HBM3e", arch: "Blackwell", displayName: "B300" },
  B200: { vram: "180GB HBM3e", arch: "Blackwell", displayName: "B200" },
  H200: { vram: "140GB HBM3e", arch: "Hopper", displayName: "H200" },
  H100: { vram: "80GB HBM3", arch: "Hopper", displayName: "H100" },
  A100_80: { vram: "80GB HBM2e", arch: "Ampere", displayName: "A100 80GB" },
  A100_40: { vram: "40GB HBM2e", arch: "Ampere", displayName: "A100 40GB" },
  A6000: { vram: "48GB GDDR6", arch: "Ampere", displayName: "RTX A6000" },
  V100: { vram: "32GB HBM2", arch: "Volta", displayName: "V100" },
  L40S: { vram: "48GB GDDR6", arch: "Ada Lovelace", displayName: "L40S" },
  L4: { vram: "24GB GDDR6", arch: "Ada Lovelace", displayName: "L4" },
  RTX6000ADA: { vram: "48GB GDDR6", arch: "Ada Lovelace", displayName: "RTX 6000 Ada" },
  RTXPRO6000: { vram: "96GB GDDR7", arch: "Blackwell", displayName: "RTX PRO 6000" },
};

const GPU_KEY_ALIASES: Record<string, string> = {
  B300: "B300",
  B200: "B200",
  H200: "H200",
  H100: "H100",
  A10080: "A100_80",
  A10040: "A100_40",
  A6000: "A6000",
  RTXA6000: "A6000",
  V100: "V100",
  L40S: "L40S",
  L4: "L4",
  RTX6000ADA: "RTX6000ADA",
  RTXPRO6000: "RTXPRO6000",
};

export const REGION_INFO: Record<string, { name: string; flag: string }> = {
  se: { name: "Sweden", flag: "🇸🇪" },
  fi: { name: "Finland", flag: "🇫🇮" },
  is: { name: "Iceland", flag: "🇮🇸" },
  va: { name: "Virginia", flag: "🇺🇸" },
  az: { name: "Arizona", flag: "🇺🇸" },
  oh: { name: "Ohio", flag: "🇺🇸" },
  br: { name: "Brazil", flag: "🇧🇷" },
  kr: { name: "South Korea", flag: "🇰🇷" },
  or: { name: "Oregon", flag: "🇺🇸" },
  ga: { name: "Georgia", flag: "🇺🇸" },
  ae: { name: "UAE", flag: "🇦🇪" },
  uk: { name: "United Kingdom", flag: "🇬🇧" },
};

function resolveGpuKey(gpuType: string): string | null {
  const compact = gpuType.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  return GPU_KEY_ALIASES[compact] || null;
}

export const getGPUDisplayName = (gpuType: string): string => {
  const key = resolveGpuKey(gpuType);
  return (key ? GPU_INFO[key]?.displayName : undefined) || gpuType.replace("_", " ");
};

export const getGPUVram = (gpuType: string): string => {
  const key = resolveGpuKey(gpuType);
  return (key ? GPU_INFO[key]?.vram : undefined) || "N/A";
};

export const getGPUArch = (gpuType: string): string => {
  const key = resolveGpuKey(gpuType);
  return (key ? GPU_INFO[key]?.arch : undefined) || "Unknown";
};

export const getRegionName = (regionCode: string): string => {
  const key = regionCode.toLowerCase();
  return REGION_INFO[key]?.name || regionCode;
};

export const getRegionFlag = (regionCode: string): string => {
  const key = regionCode.toLowerCase();
  return REGION_INFO[key]?.flag || "🌍";
};
