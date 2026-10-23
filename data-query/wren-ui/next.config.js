/* eslint-disable @typescript-eslint/no-var-requires */
const path = require('path');
const withLess = require('next-with-less');
const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
});

const resolveAlias = {
  antd$: path.resolve(__dirname, 'src/import/antd'),
};

/** @type {import('next').NextConfig} */
const nextConfig = withLess({
  output: 'standalone',
  experimental: {
    externalDir: true,
    outputFileTracingRoot: path.resolve(__dirname, '../..'),
  },
  i18n: {
    locales: ['zh-CN', 'en'],
    defaultLocale: 'zh-CN',
    localeDetection: false,
  },
  staticPageGenerationTimeout: 1000,
  compiler: {
    // Enables the styled-components SWC transform
    styledComponents: {
      displayName: true,
      ssr: true,
    },
  },
  lessLoaderOptions: {
    additionalData: `@import "@/styles/antd-variables.less";`,
    // DD-133: antd 4's CSS-variable theme. Its component styles select the
    // theme file through @root-entry-name (lib/style/index.less sets
    // `default`), so the variable entry must be forced the way antd documents
    // it, by modifyVars, which Less applies after every other definition.
    lessOptions: {
      modifyVars: { 'root-entry-name': 'variable' },
    },
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      ...resolveAlias,
    };
    return config;
  },
  // routes redirect
  async rewrites() {
    return [
      {
        source: '/platform-adapter/v1/map_native_status_error',
        destination: '/api/platform-adapter/map_native_status_error',
      },
      {
        source: '/platform-adapter/v1/handshake',
        destination: '/api/platform-adapter/handshake',
      },
      {
        source: '/platform-adapter/v1/validate_binding',
        destination: '/api/platform-adapter/validate_binding',
      },
      {
        source: '/platform-adapter/v1/reconcile',
        destination: '/api/platform-adapter/reconcile',
      },
      {
        source: '/platform-adapter/v1/observe',
        destination: '/api/platform-adapter/observe',
      },
      {
        source: '/platform-adapter/v1/execute',
        destination: '/api/platform-adapter/execute',
      },
    ];
  },
  async redirects() {
    return [
      {
        source: '/setup',
        destination: '/setup/connection',
        permanent: true,
      },
    ];
  },
});

module.exports = withBundleAnalyzer(nextConfig);
