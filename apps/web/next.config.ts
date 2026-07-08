import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Let `.svg` imports resolve to React components (via SVGR) so we can render
  // them inline as `<Logo />` instead of pointing an <img> at a URL.
  webpack(config) {
    config.module.rules.push({
      test: /\.svg$/,
      use: ['@svgr/webpack'],
    });
    return config;
  },
  // Mirror the same rule for Turbopack, in case dev/build is run with --turbopack.
  turbopack: {
    rules: {
      '*.svg': {
        loaders: ['@svgr/webpack'],
        as: '*.js',
      },
    },
  },
};

export default nextConfig;
