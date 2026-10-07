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
        source: '/platform-adapter/v1/handshake',
        destination: '/api/platform-adapter/handshake',
      },
      {
        source: '/platform-adapter/v1/validate_binding',
        destination: '/api/platform-adapter/validate_binding',
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
