# syntax=docker/dockerfile:1.7
#
# Kailo document-editor artifact (DD-132(1)): ONLYOFFICE DocumentServer 9.4.0 as a
# hybrid build of the fixed source in this repository.
#
#   rebuilt from the pin (document-editor/fork/upstream.yaml source_components):
#     server   DocService + FileConverter sources and their locked npm trees
#              (carries the Kailo SS-OFF-WOPI seam), run by node 20 — the
#              runtime the official pkg packaging targets (build_tools
#              scripts/build_server.py pkg_target "node20")
#     web-apps grunt deploy of the fixed tree (carries the SS-OFF-WOPI seam)
#     sdkjs    build/build.py concatenation of the fixed tree
#   carried by the digest-pinned official 9.4.0.1 image (package 9.4.0-129):
#     core binaries (x2t and its libraries, docbuilder, ICU/V8 data,
#     allfontsgen, allthemesgen), core-fonts, dictionaries, document-formats,
#     document-templates — equivalence recorded in upstream.yaml official_layer
#   removed (DD-35): sdkjs-plugins, pluginsmanager, example, admin panel,
#     packaging helper scripts, the AI proxy route (nginx) and every lower layer
#     of the official image (the runtime filesystem is flattened onto scratch).
#
# Recipe references (fixed GitHub commits, upstream.yaml recipe_references):
# ONLYOFFICE/build_tools v9.4.0.129 cf4cac0846d03e2e00a6fec5d1ecd4e9463086d5
# (scripts/build_server.py, build_js.py, deploy_server.py) and
# ONLYOFFICE/Docker-DocumentServer v9.4.0.129 8da03c96b1eaa13be94bdbe46c530b3109aea99e
# (run-document-server.sh, supervisor and nginx layout). Only build_tools'
# scripts/base.py is executed, by sdkjs/common/embed/make.py, exactly as
# deploy_server.py runs it.

ARG OFFICIAL_IMAGE=docker.io/onlyoffice/documentserver@sha256:e231bc62da8c1f0c1f78188f8c7e17e67716f38955d0ad1d703cf911ad6db84b
# node:20-bookworm, NODE_VERSION=20.20.2, linux/amd64 manifest.
ARG NODE_IMAGE=docker.io/library/node@sha256:cacf10e99285cbbc891452e31249c1b5ec3ba225f40028fae946b75aeaf1b66a
ARG BUILD_TOOLS_COMMIT=cf4cac0846d03e2e00a6fec5d1ecd4e9463086d5

# The pin's component trees equal the v9.4.0.131 tags of server, web-apps,
# sdkjs and core; the three rebuilt components share this version and build
# number (DocsCoServer compares the client and server build).
ARG PRODUCT_VERSION=9.4.0
ARG BUILD_NUMBER=131

# ── build_tools at its fixed commit (only for sdkjs/common/embed/make.py) ──
FROM ${NODE_IMAGE} AS build-tools
ARG BUILD_TOOLS_COMMIT
SHELL ["/bin/bash", "-euo", "pipefail", "-c"]
RUN git init -q /build/build_tools \
 && git -C /build/build_tools fetch -q --depth 1 https://github.com/ONLYOFFICE/build_tools.git "$BUILD_TOOLS_COMMIT" \
 && git -C /build/build_tools checkout -q FETCH_HEAD \
 && test "$(git -C /build/build_tools rev-parse HEAD)" = "$BUILD_TOOLS_COMMIT" \
 && rm -rf /build/build_tools/.git

# ── server: same version stamping as build_tools build_server.py ──────────
FROM ${NODE_IMAGE} AS server
ARG PRODUCT_VERSION
ARG BUILD_NUMBER
SHELL ["/bin/bash", "-euo", "pipefail", "-c"]
WORKDIR /build/server
COPY server/ ./
RUN sed -i -E "s/const buildNumber = [0-9]*/const buildNumber = ${BUILD_NUMBER}/; s/const buildVersion = '[0-9.]*'/const buildVersion = '${PRODUCT_VERSION}'/" Common/sources/commondefines.js \
 && sed -i -E "s#const buildDate = '[0-9/-]*'#const buildDate = '$(date -u +%m/%d/%Y)'#" Common/sources/license.js \
 && grep -q "const buildVersion = '${PRODUCT_VERSION}'" Common/sources/commondefines.js \
 && grep -q "const buildNumber = ${BUILD_NUMBER};" Common/sources/commondefines.js
# Locked trees (npm-shrinkwrap.json); development tools are not shipped.
RUN --mount=type=cache,id=document-editor-npm,target=/root/.npm \
    for module in Common DocService FileConverter; do npm ci --prefix "$module" --omit=dev --no-audit --no-fund; done

# ── sdkjs: build/build.py (concatenation build of the fixed tree) ─────────
FROM ${NODE_IMAGE} AS sdkjs
ARG PRODUCT_VERSION
ARG BUILD_NUMBER
SHELL ["/bin/bash", "-euo", "pipefail", "-c"]
WORKDIR /build/sdkjs
COPY sdkjs/ ./
RUN cd build && PRODUCT_VERSION="$PRODUCT_VERSION" BUILD_NUMBER="$BUILD_NUMBER" python3 build.py --beta=false --minimize \
 && test -s ../deploy/sdkjs/cell/sdk-all.js && test -s ../deploy/sdkjs/word/sdk-all-min.js

# ── web-apps: build_tools build_js.py builder target ──────────────────────
FROM ${NODE_IMAGE} AS web-apps
ARG PRODUCT_VERSION
ARG BUILD_NUMBER
SHELL ["/bin/bash", "-euo", "pipefail", "-c"]
WORKDIR /build/web-apps
COPY web-apps/ ./
COPY sdkjs/common/embed/ /build/sdkjs/common/embed/
COPY --from=build-tools /build/build_tools/ /build/build_tools/
ENV PRODUCT_VERSION=${PRODUCT_VERSION} BUILD_NUMBER=${BUILD_NUMBER}
RUN cd translation && python3 merge_and_check.py
RUN --mount=type=cache,id=document-editor-npm,target=/root/.npm \
    cd build && npm ci --no-audit --no-fund && npx grunt --verbose
# deploy_server.py: drop source maps, then add the embed worker to api.js.
RUN find deploy/web-apps/apps -name '*.js.map' -delete \
 && cd /build/sdkjs/common/embed && python3 make.py /build/web-apps/deploy/web-apps/apps/api/documents/api.js \
 && grep -q '{{HASH_POSTFIX}}' /build/web-apps/deploy/web-apps/apps/api/documents/api.js \
 && test -s /build/web-apps/deploy/web-apps/apps/api/wopi/editor-wopi.ejs \
 && for app in documenteditor spreadsheeteditor presentationeditor pdfeditor visioeditor; do \
      test -s "/build/web-apps/deploy/web-apps/apps/$app/main/app.js" || { echo "missing $app main bundle" >&2; exit 1; }; done

# ── assemble on the official layer, then flatten ───────────────────────────
FROM ${OFFICIAL_IMAGE} AS assemble
ARG PLATFORM_BUILD_ID=unknown
ARG PRODUCT_VERSION
SHELL ["/bin/bash", "-euo", "pipefail", "-c"]
ENV DS=/var/www/onlyoffice/documentserver
# Keep only the core binaries of the official server tree; everything built
# from the server, web-apps and sdkjs repositories is replaced from source.
RUN test "$(dpkg-query -W -f='${Version}' onlyoffice-documentserver)" = 9.4.0-129 \
 && mkdir -p /opt/kailo-core \
 && mv "$DS/server/FileConverter/bin" /opt/kailo-core/bin \
 && mv "$DS/server/tools" /opt/kailo-core/tools \
 && rm -f /opt/kailo-core/tools/pluginsmanager /opt/kailo-core/bin/AllFonts.js /opt/kailo-core/bin/font_selection.bin \
          /opt/kailo-core/bin/cmap.bin /opt/kailo-core/bin/*.bin.cache \
 && rm -rf "$DS/server" "$DS/web-apps" "$DS/sdkjs" "$DS/sdkjs-plugins" "$DS/npm" "$DS/fonts" \
           "$DS/license" "$DS/3rd-Party.txt" "$DS/LICENSE.txt" \
           /var/www/onlyoffice/documentserver-example /etc/onlyoffice/documentserver-example \
           /etc/onlyoffice/documentserver /etc/nginx/conf.d/* /etc/nginx/includes /etc/nginx/sites-enabled/* \
           /etc/supervisor/conf.d/* /app/ds /usr/bin/documentserver-*.sh \
           /var/lib/onlyoffice/documentserver/App_Data/* /var/log/onlyoffice \
 && test -x /opt/kailo-core/bin/x2t && test -x /opt/kailo-core/tools/allfontsgen && test -x /opt/kailo-core/tools/allthemesgen
COPY --from=server /build/server/Common/ ${DS}/server/Common/
COPY --from=server /build/server/DocService/ ${DS}/server/DocService/
COPY --from=server /build/server/FileConverter/ ${DS}/server/FileConverter/
COPY --from=server /build/server/LICENSE.txt /build/server/3rd-Party.txt ${DS}/
COPY --from=server /build/server/license/ ${DS}/license/
COPY --from=server /build/server/Common/config/default.json /build/server/Common/config/production-linux.json /etc/onlyoffice/documentserver/
COPY --from=server /build/server/Common/config/log4js/production.json /etc/onlyoffice/documentserver/log4js/production.json
COPY --from=sdkjs /build/sdkjs/deploy/sdkjs/ ${DS}/sdkjs/
COPY --from=web-apps /build/web-apps/deploy/web-apps/ ${DS}/web-apps/
COPY --from=server /usr/local/bin/node /usr/local/bin/node
COPY fork/packaging/nginx/nginx.conf /etc/nginx/nginx.conf
COPY fork/packaging/nginx/ds.conf /etc/nginx/conf.d/ds.conf
COPY fork/packaging/nginx/includes/ /etc/nginx/includes/
COPY fork/packaging/supervisord.conf /etc/kailo-ds/supervisord.conf
COPY --chmod=0755 fork/packaging/entrypoint.sh /usr/local/bin/kailo-ds-entrypoint
COPY --chmod=0755 fork/packaging/runtime-config.py /usr/local/lib/kailo-ds/runtime-config.py
# FileConverter/bin: official core binaries + cmap.bin of the rebuilt sdkjs
# (deploy_server.py), then the generated font, theme and js caches of
# documentserver-generate-allfonts.sh against the rebuilt sdkjs.
RUN mv /opt/kailo-core/bin "$DS/server/FileConverter/bin" && mv /opt/kailo-core/tools "$DS/server/tools" && rmdir /opt/kailo-core \
 && cp "$DS/sdkjs/pdf/src/engine/cmap.bin" "$DS/server/FileConverter/bin/cmap.bin" \
 && mkdir -p "$DS/fonts" \
 && "$DS/server/tools/allfontsgen" --input="$DS/core-fonts" --allfonts-web="$DS/sdkjs/common/AllFonts.js" \
      --allfonts="$DS/server/FileConverter/bin/AllFonts.js" --images="$DS/sdkjs/common/Images" \
      --selection="$DS/server/FileConverter/bin/font_selection.bin" --output-web="$DS/fonts" \
      --use-system="true" --use-system-user-fonts="false" \
 && "$DS/server/tools/allthemesgen" --converter-dir="$DS/server/FileConverter/bin" --src="$DS/sdkjs/slide/themes" --output="$DS/sdkjs/common/Images" \
 && "$DS/server/tools/allthemesgen" --converter-dir="$DS/server/FileConverter/bin" --src="$DS/sdkjs/slide/themes" --output="$DS/sdkjs/common/Images" --postfix="ios" --params="280,224" \
 && "$DS/server/tools/allthemesgen" --converter-dir="$DS/server/FileConverter/bin" --src="$DS/sdkjs/slide/themes" --output="$DS/sdkjs/common/Images" --postfix="android" --params="280,224" \
 && "$DS/server/FileConverter/bin/x2t" -create-js-cache \
 && rm -f "$DS"/fonts/*.gz "$DS/sdkjs/common/AllFonts.js.gz" "$DS"/sdkjs/common/Images/*.gz "$DS/sdkjs/slide/themes/themes.js.gz"
# Cache tag of documentserver-flush-cache.sh, fixed per source build instead
# of per container start; nginx and api.js must agree on it.
RUN tag=$(printf '%s' "$PLATFORM_BUILD_ID" | sha256sum | cut -c1-32) \
 && sed -i "s/{{HASH_POSTFIX}}/${tag}/g" "$DS/web-apps/apps/api/documents/api.js" \
 && ! grep -q '{{HASH_POSTFIX}}\|{{PRODUCT_VERSION}}' "$DS/web-apps/apps/api/documents/api.js" \
 && printf 'set $cache_tag "%s";\n' "$tag" > /etc/nginx/includes/ds-cache.conf \
 && sed -i "s#@PRODUCT_VERSION@#${PRODUCT_VERSION}#g" /etc/nginx/includes/ds-docservice.conf \
 && mkdir -p /var/lib/onlyoffice/documentserver/App_Data/cache/files /var/lib/onlyoffice/documentserver/App_Data/docbuilder /var/www/onlyoffice/Data \
 && chown -R ds:ds "$DS" /var/lib/onlyoffice \
 && chown -R root:root /etc/onlyoffice /etc/nginx /etc/kailo-ds \
 && chmod -R go-w "$DS" /etc/onlyoffice \
 && test ! -e "$DS/sdkjs-plugins" && test ! -e "$DS/server/tools/pluginsmanager"

FROM scratch
COPY --from=assemble / /
ENV PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    LANG=en_US.UTF-8 LANGUAGE=en_US:en LC_ALL=en_US.UTF-8 \
    DS_RUNTIME_DIR=/run/kailo-ds
LABEL org.opencontainers.image.title="Kailo document-editor (ONLYOFFICE DocumentServer 9.4.0)" \
      org.opencontainers.image.licenses="AGPL-3.0-only"
EXPOSE 80
VOLUME ["/var/lib/onlyoffice"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD ["/usr/bin/curl", "-fsS", "-o", "/dev/null", "http://127.0.0.1/healthcheck"]
ENTRYPOINT ["/usr/local/bin/kailo-ds-entrypoint"]
