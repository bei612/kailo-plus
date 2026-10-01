# The existing tools/check.sh remains the only gate implementation (ADR-07).
# This image supplies its four language toolchains; it contains no project source.
FROM rust:1.90-slim-bookworm@sha256:64232e656c058f4468e8d024e990acff04f0fd5a5c0a88a574dc37773d7325c9 AS rust
FROM golang:1.25-bookworm@sha256:3b4a11519ad929d1e1d261a12cff056f0c85b735253d7d861346b9c6f8b36437 AS go
FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS node
FROM dart:3.9.4@sha256:9db24325a8df958f4aa64e0880d8254ba304602c1d85ecee326b2c576883cc3a

COPY --from=rust /usr/local/cargo /usr/local/cargo
COPY --from=rust /usr/local/rustup /usr/local/rustup
COPY --from=go /usr/local/go /usr/local/go
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY --from=node /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/npm

ENV CARGO_HOME=/usr/local/cargo \
    RUSTUP_HOME=/usr/local/rustup \
    PATH=/usr/local/cargo/bin:/usr/local/go/bin:/usr/lib/dart/bin:/usr/local/bin:/usr/bin:/bin \
    GOTOOLCHAIN=local

RUN apt-get update \
    && apt-get install --no-install-recommends -y \
       bash build-essential ca-certificates curl git libssl-dev \
       pkg-config postgresql-client procps python3 python3-yaml \
    && rm -rf /var/lib/apt/lists/* \
    && ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
    && ln -s /usr/local/lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx

RUN rustup component add rustfmt clippy \
    && cargo --version && rustfmt --version && cargo clippy --version \
    && go version && node --version && dart --version

RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/tmp/sqlx-build \
    CARGO_TARGET_DIR=/tmp/sqlx-build cargo install sqlx-cli --version 0.8.6 --locked \
      --no-default-features --features postgres,rustls

WORKDIR /workspace/apps
CMD ["bash", "tools/check.sh", "--full"]
