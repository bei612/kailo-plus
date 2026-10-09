FROM eclipse-temurin:21@sha256:3e3c176ffed168beb42c607be9bc1639b466cf00261a0fb04425562c9d0c5c2b AS base

FROM base AS build
WORKDIR /build
COPY . ./
# The original wrapper fixes Maven 3.9.8; the original exec-jar profile owns
# assembly. No externally built JAR or original upstream Engine image is used.
# Source archives have no .git; the existing artifact manifest owns provenance.
# Only Git metadata extraction is skipped, not source/style/business checks.
RUN --mount=type=cache,id=kailo-wren-engine-maven,target=/root/.m2,sharing=locked \
    ./mvnw -B -ntp install -DskipTests -P exec-jar -Dmaven.gitcommitid.skip=true

FROM build AS verification
RUN --mount=type=cache,id=kailo-wren-engine-maven,target=/root/.m2,sharing=locked \
    ./mvnw -B -ntp test -pl :wren-tests -Dtest=TestAnalysisResource -Dmaven.gitcommitid.skip=true

FROM base AS runtime
LABEL maintainer="https://www.canner.io/"
WORKDIR /usr/src/app

RUN \
    apt update && \
    apt -y install curl gpg lsb-release && \
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /etc/apt/trusted.gpg.d/postgresql.gpg && \
    echo "deb http://apt.postgresql.org/pub/repos/apt/ `lsb_release -cs`-pgdg main" | tee /etc/apt/sources.list.d/pgdg.list && \
    apt update && \
    apt -y install postgresql-client-13

COPY --from=verification /build/wren-server/target/wren-server-*-executable.jar ./wren-server-executable.jar
ENV WREN_JAR=wren-server-executable.jar

COPY docker/entrypoint.sh ./
RUN chmod +x ./entrypoint.sh

CMD ./entrypoint.sh ${WREN_JAR} ${MAX_HEAP_SIZE} ${MIN_HEAP_SIZE}
