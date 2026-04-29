import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const sourceRoot = path.join(appRoot, "src");

const FORBIDDEN_PATTERNS = [
  {
    name: "raw fetch",
    pattern: /\bfetch\s*\(/,
    replacement: "Use an official @hypercli.com/sdk method.",
  },
  {
    name: "raw axios import",
    pattern: /\b(?:import\s+.+\s+from\s+|import\s*\(|require\s*\()\s*["']axios["']/,
    replacement: "Use an official @hypercli.com/sdk method.",
  },
  {
    name: "x402 axios import",
    pattern: /\b(?:import\s+.+\s+from\s+|import\s*\(|require\s*\()\s*["']@x402\/axios["']/,
    replacement: "Use the SDK-owned x402 helper instead of app-level axios wiring.",
  },
  {
    name: "XMLHttpRequest",
    pattern: /\bXMLHttpRequest\b/,
    replacement: "Use an official @hypercli.com/sdk method.",
  },
  {
    name: "sendBeacon",
    pattern: /\bnavigator\.sendBeacon\b/,
    replacement: "Use an official @hypercli.com/sdk method.",
  },
  {
    name: "clawFetch",
    pattern: /\bclawFetch\b/,
    replacement: "Use an official @hypercli.com/sdk method.",
  },
  {
    name: "agentApiFetch",
    pattern: /\bagentApiFetch\b/,
    replacement: "Use an official @hypercli.com/sdk method.",
  },
];

const ALLOWED_EXTENSIONS = new Set([".ts", ".tsx"]);
const IGNORED_DIRS = new Set(["node_modules", ".next", ".turbo", "storybook-static", "playwright-report"]);

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walk(fullPath));
    } else if (ALLOWED_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files;
}

export function scanSourceText(source, filePath = "<inline>") {
  const violations = [];
  const lines = source.split(/\r?\n/);

  lines.forEach((line, index) => {
    for (const forbidden of FORBIDDEN_PATTERNS) {
      if (forbidden.pattern.test(line)) {
        violations.push({
          filePath,
          line: index + 1,
          rule: forbidden.name,
          source: line.trim(),
          replacement: forbidden.replacement,
        });
      }
    }
  });

  return violations;
}

export function scanFiles(files) {
  return files.flatMap((filePath) => scanSourceText(fs.readFileSync(filePath, "utf8"), filePath));
}

export function scanClawSource(root = sourceRoot) {
  return scanFiles(walk(root));
}

export function formatViolation(violation) {
  const relativePath = path.relative(appRoot, violation.filePath).replace(/\\/g, "/");
  return [
    `${relativePath}:${violation.line} violates SDK-only API boundary (${violation.rule})`,
    `  ${violation.source}`,
    `  ${violation.replacement} If the SDK is missing the capability, raise an SDK/API requirement.`,
  ].join("\n");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const violations = scanClawSource();
  if (violations.length > 0) {
    console.error(violations.map(formatViolation).join("\n\n"));
    process.exitCode = 1;
  }
}
