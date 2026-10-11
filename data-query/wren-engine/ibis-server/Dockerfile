FROM rust:1.90-slim-bookworm@sha256:64232e656c058f4468e8d024e990acff04f0fd5a5c0a88a574dc37773d7325c9 AS rust
FROM python:3.11-bookworm@sha256:5887f265d8d44d8b4734d3658b21d668edf5aaf92e4945bc0c984afbfab105d3 AS builder

# Same native extension build as wren-core-py's just build, without fetching
# unversioned rustup/just installers. The original lock files remain authoritative.
COPY --from=rust /usr/local/cargo /usr/local/cargo
COPY --from=rust /usr/local/rustup /usr/local/rustup
ENV CARGO_HOME=/usr/local/cargo RUSTUP_HOME=/usr/local/rustup
ENV PATH="/usr/local/cargo/bin:$PATH"
RUN apt-get update && apt-get -y install --no-install-recommends libpq-dev \
    && rm -rf /var/lib/apt/lists/*

    # python
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    # pip
    PIP_NO_CACHE_DIR=off \
    PIP_DISABLE_PIP_VERSION_CHECK=on \
    PIP_DEFAULT_TIMEOUT=100 \
    # poetry
    POETRY_NO_INTERACTION=1 \
    POETRY_VIRTUALENVS_IN_PROJECT=1 \
    POETRY_VIRTUALENVS_CREATE=1

RUN pip install poetry==1.8.3

COPY wren-core-py /wren-core-py
COPY wren-core /wren-core
COPY wren-core-base /wren-core-base

WORKDIR /wren-core-py
RUN --mount=type=cache,target=/root/.cache/pypoetry \
    poetry install --only main --no-root
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/usr/local/cargo/git \
    --mount=type=cache,target=/wren-core-py/target \
    poetry run maturin build --release --locked --out /wheels

WORKDIR /app
COPY ibis-server/pyproject.toml ibis-server/poetry.lock ./
RUN --mount=type=cache,target=/root/.cache/pypoetry \
    poetry install --without dev --no-root \
    && poetry run pip install --no-deps /wheels/*.whl


FROM python:3.11-slim-bookworm@sha256:0a310eeecf4e1f5a0743f9a6520c90c88d089c903ca5fd283f501e3a805f5f89 AS runtime

# Add microsoft package list
RUN apt-get update \
    && apt-get install -y curl gnupg \
    && curl https://packages.microsoft.com/keys/microsoft.asc | tee /etc/apt/trusted.gpg.d/microsoft.asc \
    && curl https://packages.microsoft.com/config/debian/12/prod.list | tee /etc/apt/sources.list.d/mssql-release.list \
    && apt-get update

# Install msodbcsql 18 driver for mssql
RUN ACCEPT_EULA=Y apt-get -y install unixodbc-dev msodbcsql18

# Install libmysqlclient-dev for mysql
RUN apt-get install -y default-libmysqlclient-dev

# libpq-dev is required for psycopg2
RUN apt-get -y install libpq-dev \
    && rm -rf /var/lib/apt/lists/*

ENV VIRTUAL_ENV=/app/.venv \
    PATH="/app/.venv/bin:$PATH" \
    REMOTE_FUNCTION_LIST_PATH=/resources/function_list

COPY --from=builder ${VIRTUAL_ENV} ${VIRTUAL_ENV}
WORKDIR /app
COPY ibis-server/app app
COPY ibis-server/resources /resources

EXPOSE 8000

CMD ["fastapi", "run"]
