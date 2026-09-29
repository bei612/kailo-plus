# Mobile 客户端的 Android release 安装包构建（DD-74、ADR-06「客户端发布单元按端分离」）。
#
# 构建上下文是 apps/（ADR-16）：collaboration/mobile/ 与它以 Flutter path: 依赖引用的
# client-kit/dart（契约 Dart 生成物与平台文案），保持与仓库里相同的相对位置。
# 产物是 release APK 而不是镜像：最后一个阶段只含安装包，调用方以 `--output type=local`
# 取出，摘要记安装包字节的 SHA-256。
#
# 签名：上游 mobile/android/app/build.gradle.kts 的 release 构建在 upload keystore 四项
# （BUZZ_ANDROID_UPLOAD_KEYSTORE_PATH/PASSWORD、KEY_ALIAS、KEY_PASSWORD）缺任一项时直接失败，
# 不回退到 debug 证书。四项由 build-upstream.sh 以 BuildKit secret 传入（记录的 build_secrets），
# 不进镜像层、不进构建参数；keystore 文件本身以 secret 挂载成文件。
#
# 工具链以源码树为准：Flutter 3.41.7 取自 bin/.flutter-3.41.7.pkg（上游 Hermit 的固定版本）。

FROM ghcr.io/cirruslabs/flutter:3.41.7@sha256:644e3cea0a8440ce75804b67ceab77b16a87b39d9e9d89b07aceca7a98af1aa3 AS build
COPY client-kit/dart/ /src/client-kit/dart/
COPY collaboration/mobile/ /src/collaboration/mobile/
WORKDIR /src/collaboration/mobile
RUN flutter pub get --enforce-lockfile
# 应用名是部署配置（DD-111）：由发布配置以构建参数注入（记录的 build_args），release 构建
# 缺失即失败（android/app/build.gradle.kts）；源码里不写应用名。
ARG PLATFORM_DISPLAY_NAME
RUN --mount=type=secret,id=BUZZ_ANDROID_UPLOAD_KEYSTORE,target=/run/secrets/upload-keystore.jks,required=true \
    --mount=type=secret,id=BUZZ_ANDROID_UPLOAD_KEYSTORE_PASSWORD,required=true \
    --mount=type=secret,id=BUZZ_ANDROID_UPLOAD_KEY_ALIAS,required=true \
    --mount=type=secret,id=BUZZ_ANDROID_UPLOAD_KEY_PASSWORD,required=true \
    BUZZ_ANDROID_UPLOAD_KEYSTORE_PATH=/run/secrets/upload-keystore.jks \
    BUZZ_ANDROID_UPLOAD_KEYSTORE_PASSWORD="$(cat /run/secrets/BUZZ_ANDROID_UPLOAD_KEYSTORE_PASSWORD)" \
    BUZZ_ANDROID_UPLOAD_KEY_ALIAS="$(cat /run/secrets/BUZZ_ANDROID_UPLOAD_KEY_ALIAS)" \
    BUZZ_ANDROID_UPLOAD_KEY_PASSWORD="$(cat /run/secrets/BUZZ_ANDROID_UPLOAD_KEY_PASSWORD)" \
    PLATFORM_DISPLAY_NAME="$PLATFORM_DISPLAY_NAME" \
    flutter build apk --release --no-pub \
    && mkdir -p /out \
    && cp build/app/outputs/flutter-apk/app-release.apk /out/buzz-mobile_release.apk

FROM scratch AS bundle
COPY --from=build /out/ /
