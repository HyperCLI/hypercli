# syntax=docker/dockerfile:1.7

# Builds ONLY the hyper-acp binary (release) from the repo workspace.
# Final image is a scratch file-server image: acp-base/Coding images pull
# /acp out of it via `FROM ${ACP_IMAGE} AS acp` + `COPY --from=acp /acp ...`,
# so the full Rust toolchain never lands in runtime images.

ARG RUST_IMAGE=docker.io/library/rust:1.95.0-bookworm@sha256:6258907abe69656e41cd992e0b705cdcfabcbbe3db374f92ed2d47121282d4a1

FROM ${RUST_IMAGE} AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    git \
    libssl-dev \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
COPY Cargo.toml Cargo.lock* ./
COPY rs-sdk ./rs-sdk
COPY acp/hyper-acp ./acp/hyper-acp

RUN --mount=type=cache,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,target=/usr/local/cargo/git,sharing=locked \
    --mount=type=cache,target=/build/target,sharing=locked \
    set -eux; \
    cargo build --release --manifest-path /build/Cargo.toml -p hyper-acp; \
    BIN="$(find /build/target/release -maxdepth 1 -type f -executable \( -name 'acp' -o -name 'hyper-acp' \) | head -1)"; \
    test -n "${BIN}"; \
    install -D -m 0755 "${BIN}" /out/acp; \
    strip /out/acp

FROM scratch
COPY --from=builder /out/acp /acp
