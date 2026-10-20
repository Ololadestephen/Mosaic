import type { NextConfig } from "next";

const config: NextConfig = {
  poweredByHeader: false,
  agentRules: false,
  output: "standalone",
  env: {
    MOSAIC_BUILD_COMMIT: /^[a-f0-9]{40}$/.test(
      process.env.VERCEL_GIT_COMMIT_SHA ??
        process.env.MOSAIC_BUILD_COMMIT ??
        "",
    )
      ? (process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.MOSAIC_BUILD_COMMIT)
      : "local",
  },
  distDir: process.env.MOSAIC_E2E === "true" ? ".local/e2e-next" : ".next",
  outputFileTracingExcludes: {
    "/*": [
      "./.local/**",
      "./.desloppify/**",
      "./*.md",
      "./tests/**",
      "./.env*",
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ws:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
          },
        ],
      },
    ];
  },
};

export default config;
