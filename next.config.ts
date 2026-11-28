import type { NextConfig } from 'next';

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''),
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://accounts.google.com",
].join('; ');

const nextConfig: NextConfig = {
  output: 'standalone',
  serverExternalPackages: ['better-sqlite3', 'sharp', 'heic-convert', 'file-type'],
  // file-type (upload type check) and its dependencies are ESM packages whose entry files the
  // tracer misses; without them every upload fails at "complete" in the Docker image.
  outputFileTracingIncludes: {
    '/api/**': [
      './node_modules/file-type/**',
      './node_modules/strtok3/**',
      './node_modules/token-types/**',
      './node_modules/@tokenizer/**',
      './node_modules/@borewit/**',
      './node_modules/uint8array-extras/**',
      './node_modules/ieee754/**',
      './node_modules/debug/**',
      './node_modules/ms/**',
    ],
  },
  images: { unoptimized: true }, // thumbnails come from our own API
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'Referrer-Policy', value: 'same-origin' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
          { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
