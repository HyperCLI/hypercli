import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const sourceRoot = path.join(appRoot, "src");

const FORBIDDEN_IMPORT_PATTERNS = [
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
];

const FORBIDDEN_CODE_PATTERNS = [
  {
    name: "raw fetch",
    pattern: /\bfetch\s*\(/,
    replacement: "Use an official @hypercli.com/sdk method.",
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
    name: "raw WebSocket",
    pattern: /\bnew\s+WebSocket\s*\(/,
    replacement: "Use the OpenClaw SDK gateway/session APIs.",
  },
  {
    name: "raw EventSource",
    pattern: /\bnew\s+EventSource\s*\(/,
    replacement: "Use an official @hypercli.com/sdk streaming method.",
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

function maskSourceLiteralsAndComments(source) {
  let output = "";
  let i = 0;
  let state = "code";

  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];

    if (state === "line-comment") {
      if (char === "\n") {
        output += "\n";
        state = "code";
      } else {
        output += " ";
      }
      i += 1;
      continue;
    }

    if (state === "block-comment") {
      if (char === "*" && next === "/") {
        output += "  ";
        i += 2;
        state = "code";
      } else {
        output += char === "\n" ? "\n" : " ";
        i += 1;
      }
      continue;
    }

    if (state === "single" || state === "double" || state === "template") {
      const endChar = state === "single" ? "'" : state === "double" ? '"' : "`";
      if (char === "\\") {
        output += " ";
        if (next) output += next === "\n" ? "\n" : " ";
        i += 2;
        continue;
      }
      if (char === endChar) {
        output += " ";
        i += 1;
        state = "code";
        continue;
      }
      output += char === "\n" ? "\n" : " ";
      i += 1;
      continue;
    }

    if (char === "/" && next === "/") {
      output += "  ";
      i += 2;
      state = "line-comment";
      continue;
    }
    if (char === "/" && next === "*") {
      output += "  ";
      i += 2;
      state = "block-comment";
      continue;
    }
    if (char === "'") {
      output += " ";
      i += 1;
      state = "single";
      continue;
    }
    if (char === '"') {
      output += " ";
      i += 1;
      state = "double";
      continue;
    }
    if (char === "`") {
      output += " ";
      i += 1;
      state = "template";
      continue;
    }

    output += char;
    i += 1;
  }

  return output;
}

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
  const codeLines = maskSourceLiteralsAndComments(source).split(/\r?\n/);

  lines.forEach((line, index) => {
    for (const forbidden of FORBIDDEN_IMPORT_PATTERNS) {
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
    for (const forbidden of FORBIDDEN_CODE_PATTERNS) {
      if (forbidden.pattern.test(codeLines[index] ?? "")) {
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
