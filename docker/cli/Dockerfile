# syntax=docker/dockerfile:1.7

# Builds the HyperCLI agent toolchain from THIS repo's checked-out tree and
# ships only what agent images need at runtime:
#   /opt/hypercli/bin/hyper   — ts-cli bundled+minified into a single file
#                               (esbuild; ts-sdk inlined; skills exported
#                               before bundling)
#   /opt/hypercli/skills      — skill bodies and generated CLI JSON catalog

ARG NODE_IMAGE=docker.io/library/node:24-bookworm-slim@sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d

FROM ${NODE_IMAGE} AS builder

WORKDIR /opt/hypercli
COPY ts-sdk/package.json ts-sdk/package-lock.json ./ts-sdk/
COPY ts-cli/package.json ts-cli/package-lock.json ./ts-cli/
RUN --mount=type=cache,target=/root/.npm \
    npm --prefix ts-sdk ci && \
    npm --prefix ts-cli ci

COPY ts-sdk ./ts-sdk
COPY ts-cli ./ts-cli
COPY skills ./skills

RUN --mount=type=cache,target=/root/.npm \
    test -n "$(find /opt/hypercli/skills -type f -name SKILL.md -print -quit)" && \
    npm --prefix ts-sdk run build && \
    npm --prefix ts-cli run build && \
    node /opt/hypercli/ts-cli/dist/index.js --help >/dev/null && \
    node /opt/hypercli/ts-cli/dist/index.js skills export /bundle-skills >/dev/null

# Bundle to a single minified entrypoint. The banner supplies `require` for
# bundled CJS deps (ws) in the ESM output.
RUN --mount=type=cache,target=/root/.npm \
    npx -y esbuild /opt/hypercli/ts-cli/dist/index.js \
      --bundle --minify --platform=node --target=node24 --format=esm \
      '--banner:js=import { createRequire } from "node:module"; const require = createRequire(import.meta.url);' \
      '--define:HYPERCLI_SKILLS_RELATIVE_PATH="../skills/"' \
      --outfile=/bundle/opt/hypercli/bin/hyper && \
    chmod 0755 /bundle/opt/hypercli/bin/hyper && \
    cp /opt/hypercli/ts-cli/package.json /bundle/opt/hypercli/package.json && \
    cp -r /bundle-skills /bundle/opt/hypercli/skills && \
    cp /opt/hypercli/ts-cli/skills/*.json /bundle/opt/hypercli/skills/ && \
    node /bundle/opt/hypercli/bin/hyper --help >/dev/null

# Exercise the shipped single-file layout, not the unbundled builder CLI.
RUN --network=none node --input-type=module -e '\
    import assert from "node:assert/strict"; \
    import { execFileSync } from "node:child_process"; \
    import { readFileSync } from "node:fs"; \
    const root = "/bundle/opt/hypercli"; \
    const cli = (...args) => execFileSync(process.execPath, [`${root}/bin/hyper`, ...args], { encoding: "utf8" }); \
    const expected = JSON.parse(readFileSync(`${root}/skills/index.json`)).skills.map(s => s.name); \
    assert.ok(expected.length > 0); \
    assert.deepEqual(JSON.parse(cli("skills", "list", "--json")).map(s => s.name), expected); \
    cli("skills", "export", "/verify-skills"); \
    for (const name of expected) { \
      const body = readFileSync(`${root}/skills/${name}/SKILL.md`, "utf8"); \
      assert.equal(readFileSync(`/verify-skills/${name}/SKILL.md`, "utf8"), body); \
      assert.doesNotMatch(body.replace(/\\\r?\n/g, " "), /\bhyper[^`\n]*[ \t]--(?:dev|prod)\b/, `${name}: public commands must use HYPER_API_BASE or HyperCLI config`); \
    }'

FROM scratch AS toolchain
COPY --from=builder /bundle/opt/hypercli /opt/hypercli

FROM ${NODE_IMAGE} AS runtime
COPY --from=toolchain /opt/hypercli /opt/hypercli
RUN ln -s /opt/hypercli/bin/hyper /usr/local/bin/hyper
ENTRYPOINT ["/usr/local/bin/hyper"]
