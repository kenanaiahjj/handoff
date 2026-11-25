import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

/** Changes with every build/deploy; open windows compare it with the server to offer a reload. */
const buildId = process.env.VERCEL_GIT_COMMIT_SHA || process.env.ASBIR_BUILD_ID || `${Date.now()}`;

function git(args: string[]) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return ""; // No git (for example a Docker build): the update card just shows no change list.
  }
}

/** What this build contains, for the "new version is ready" card: newest commit first. */
const commit = process.env.VERCEL_GIT_COMMIT_SHA || git(["rev-parse", "HEAD"]);
const releaseNotes = git(["log", "-n", "200", "--no-merges", "--format=%H%x09%cs%x09%s"])
  .split("\n")
  .filter(Boolean)
  .map((line) => {
    const [sha, date, ...subject] = line.split("\t");
    return { sha, date, subject: subject.join("\t") };
  });
const today = new Date().toISOString().slice(0, 10);
const versionLabel = (releaseNotes[0]?.date ?? today).replaceAll("-", ".");

/** The built-in Figma naming handbook, served until a workspace saves its own copy. */
function readDefaultHandbook() {
  for (const candidate of ["../../docs/figma-naming.md", "docs/figma-naming.md"]) {
    try {
      return readFileSync(path.resolve(process.cwd(), candidate), "utf8");
    } catch {
      // Built from another folder: try the next place.
    }
  }
  return "";
}

const nextConfig: NextConfig = {
  // The Next.js dev badge goes bottom-right so the local Waves test bar can have the bottom-left corner.
  devIndicators: { position: "bottom-right" },
  env: {
    NEXT_PUBLIC_ASBIR_BUILD_ID: buildId,
    NEXT_PUBLIC_ASBIR_COMMIT: commit,
    ASBIR_VERSION_LABEL: versionLabel,
    ASBIR_RELEASE_NOTES: JSON.stringify(releaseNotes),
    ASBIR_DEFAULT_HANDBOOK: readDefaultHandbook(),
  },
  /* config options here */
  distDir: process.env.ASBIR_NEXT_DIST_DIR || ".next",
  transpilePackages: ["@asbir/snapshot-contract"],
  // The downloadable Figma plugin is read from disk by its route, so ship the built template with it.
  outputFileTracingIncludes: {
    "/api/figma-plugin": ["./figma-plugin-template/**/*"],
    "/api/capture-sessions/plugin-version": ["./figma-plugin-template/build-id.txt"],
    // The Playground is created from these files on its first visit (src/server/services/playground.ts).
    "/playground": ["./playground/**/*"],
  },
  // Addresses used to carry the company workspace's id (/workspace/<id>/projects/…). Links shared
  // before it was dropped keep working.
  async redirects() {
    const workspaceId = ":workspaceId([0-9a-fA-F-]{36})";
    return [
      { source: `/workspace/${workspaceId}`, destination: "/workspace", permanent: false },
      { source: `/workspace/${workspaceId}/:path+`, destination: "/:path+", permanent: false },
    ];
  },
  cacheComponents: true,
  partialPrefetching: true,
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
