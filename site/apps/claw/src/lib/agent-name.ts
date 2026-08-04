const blockedAgentNameWords = new Set(["signal"]);

const agentNameFirstWords = [
  "bright", "clear", "fresh", "rapid", "solar", "quiet", "prime", "silver",
  "steady", "swift", "agile", "amber", "arctic", "astral", "autumn", "azure",
  "bold", "brisk", "calm", "clever", "cobalt", "cosmic", "crisp", "dawn",
  "deep", "eager", "early", "electric", "ember", "emerald", "endless", "fair",
  "fast", "fearless", "fleet", "fluid", "focused", "forest", "gentle", "gilded",
  "glass", "golden", "grand", "green", "hardy", "hidden", "icy", "indigo",
  "ivory", "keen", "kind", "lucid", "lunar", "mellow", "merry", "midnight",
  "mighty", "misty", "modern", "nimble", "noble", "northern", "nova", "ocean",
  "open", "patient", "pearl", "polar", "proud", "quick", "radiant", "ready",
  "red", "rising", "river", "royal", "ruby", "sage", "serene", "sharp",
  "sky", "sleek", "smart", "solid", "sonic", "spring", "stable", "starry",
  "steel", "still", "stone", "stormy", "sunny", "tidal", "true", "velvet",
  "vivid", "warm", "wild", "winter", "wise", "young", "zen", "airy",
  "alpine", "balanced", "breezy", "celestial", "coastal", "copper", "crystal", "dynamic",
  "eastern", "evergreen", "glowing", "graceful", "limitless", "lucky", "magnetic", "maple",
  "opal", "peaceful", "playful", "resilient", "roaming", "secret", "timeless", "western",
] as const;

const agentNameSecondWords = [
  "atlas", "beam", "forge", "harbor", "matrix", "orbit", "pilot", "signal",
  "vector", "window", "beacon", "birch", "blaze", "bloom", "bolt", "breeze",
  "brook", "canyon", "cedar", "cipher", "cloud", "comet", "compass", "coral",
  "cosmos", "crane", "crest", "delta", "drift", "dune", "echo", "ember",
  "falcon", "fern", "flame", "flux", "frost", "galaxy", "glade", "grove",
  "hawk", "horizon", "iris", "isle", "ivy", "jade", "juniper", "kite",
  "lake", "lantern", "lark", "leaf", "light", "lotus", "maple", "marble",
  "meadow", "meteor", "moon", "moss", "nebula", "nova", "oasis", "ocean",
  "owl", "pearl", "phoenix", "pine", "prism", "pulse", "quartz", "raven",
  "reef", "ridge", "river", "robin", "rocket", "rose", "sage", "sail",
  "scout", "shadow", "shore", "sky", "spark", "star", "stone", "storm",
  "summit", "sun", "tide", "timber", "torch", "trail", "valley", "vapor",
  "vertex", "violet", "wave", "willow", "wind", "wolf", "wren", "zenith",
  "acorn", "aurora", "badger", "bay", "bison", "bluejay", "cascade", "clover",
  "copper", "cypress", "eagle", "elm", "firefly", "glacier", "heron", "kestrel",
  "lagoon", "lion", "meridian", "otter", "pebble", "sequoia", "sparrow", "thunder",
] as const;

const agentNameThirdWords = [
  "anchor", "bridge", "engine", "field", "garden", "lab", "node", "studio",
  "tower", "works", "arch", "base", "bay", "cabin", "camp", "castle",
  "cave", "center", "citadel", "cove", "craft", "deck", "dock", "domain",
  "gateway", "grid", "hall", "haven", "hearth", "helm", "hive", "house",
  "hub", "island", "junction", "keep", "key", "lane", "link", "lodge",
  "loft", "meadow", "mill", "nest", "nexus", "outpost", "park", "path",
  "peak", "pier", "place", "platform", "point", "port", "post", "range",
  "relay", "reserve", "ridge", "ring", "road", "root", "route", "station",
  "summit", "trail", "vault", "village", "vista", "waypoint", "well", "wing",
  "yard", "zone", "arcade", "arena", "beacon", "borough", "branch", "campus",
  "channel", "circle", "court", "crossing", "district", "estate", "factory", "farm",
  "fort", "gallery", "garage", "harbor", "headquarters", "hill", "horizon", "inlet",
  "landmark", "library", "lighthouse", "manor", "market", "observatory", "orchard", "pavilion",
  "plaza", "portal", "quarter", "ranch", "refuge", "runway", "sanctuary", "shelter",
  "shipyard", "square", "terrace", "terminal", "workshop", "alcove", "annex", "depot",
  "frontier", "homestead", "lookout", "nursery", "roost", "stronghold", "township", "waterway",
] as const;

function allowedWords(words: readonly string[]): string[] {
  return [...new Set(words)].filter((word) => (
    /^[a-z]+$/.test(word) && !blockedAgentNameWords.has(word)
  ));
}

const allowedFirstWords = allowedWords(agentNameFirstWords);
const allowedSecondWords = allowedWords(agentNameSecondWords);
const allowedThirdWords = allowedWords(agentNameThirdWords);
const allowedFirstWordSet = new Set(allowedFirstWords);
const allowedSecondWordSet = new Set(allowedSecondWords);
const allowedThirdWordSet = new Set(allowedThirdWords);

export const AGENT_NAME_COMBINATION_COUNT = (
  allowedFirstWords.length * allowedSecondWords.length * allowedThirdWords.length
);

const UINT32_RANGE = 0x1_0000_0000;

function randomIndex(maxExclusive: number): number {
  if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > UINT32_RANGE) {
    throw new RangeError("Agent name pool size is invalid.");
  }

  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const unbiasedLimit = UINT32_RANGE - (UINT32_RANGE % maxExclusive);
    const values = new Uint32Array(1);
    do {
      crypto.getRandomValues(values);
    } while (values[0] >= unbiasedLimit);
    return values[0] % maxExclusive;
  }

  return Math.floor(Math.random() * maxExclusive);
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = left;
  let b = right;
  while (b !== 0) {
    const remainder = a % b;
    a = b;
    b = remainder;
  }
  return a;
}

function nameAt(index: number): string {
  const thirdIndex = index % allowedThirdWords.length;
  const secondAndFirstIndex = Math.floor(index / allowedThirdWords.length);
  const secondIndex = secondAndFirstIndex % allowedSecondWords.length;
  const firstIndex = Math.floor(secondAndFirstIndex / allowedSecondWords.length);
  return `${allowedFirstWords[firstIndex]}-${allowedSecondWords[secondIndex]}-${allowedThirdWords[thirdIndex]}`;
}

export function isGeneratedAgentName(name: string | null | undefined): boolean {
  if (!name) return false;
  const words = name.trim().toLowerCase().split("-");
  return words.length === 3
    && allowedFirstWordSet.has(words[0])
    && allowedSecondWordSet.has(words[1])
    && allowedThirdWordSet.has(words[2]);
}

export function generateAgentName(unavailableNames: Iterable<string> = []): string {
  const unavailable = new Set(
    Array.from(unavailableNames, (name) => name.trim().toLowerCase()).filter(Boolean),
  );
  const start = randomIndex(AGENT_NAME_COMBINATION_COUNT);
  let step = randomIndex(AGENT_NAME_COMBINATION_COUNT - 1) + 1;

  while (greatestCommonDivisor(step, AGENT_NAME_COMBINATION_COUNT) !== 1) {
    step = step === AGENT_NAME_COMBINATION_COUNT - 1 ? 1 : step + 1;
  }

  for (let offset = 0; offset < AGENT_NAME_COMBINATION_COUNT; offset += 1) {
    const candidate = nameAt((start + (offset * step)) % AGENT_NAME_COMBINATION_COUNT);
    if (!unavailable.has(candidate)) return candidate;
  }

  throw new Error("No agent names are available.");
}
