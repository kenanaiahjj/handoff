import type { NextConfig } from "next";

/** Changes with every build/deploy; open windows compare it with the server to offer a reload. */
const buildId = process.env.VERCEL_GIT_COMMIT_SHA || process.env.ASBIR_BUILD_ID || `${Date.now()}`;

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_ASBIR_BUILD_ID: buildId },
  /* config options here */
  distDir: process.env.ASBIR_NEXT_DIST_DIR || ".next",
  cacheComponents: true,
  partialPrefetching: true,
  serverExternalPackages: ["better-sqlite3"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
