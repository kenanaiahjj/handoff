import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const appDirectory = path.resolve("apps/web");
const examplePath = path.join(appDirectory, ".env.example");
const localPath = path.join(appDirectory, ".env.local");

if (existsSync(localPath)) {
  process.stdout.write("apps/web/.env.local already exists.\n");
  process.exit(0);
}

const template = readFileSync(examplePath, "utf8");
const secret = randomBytes(32).toString("base64url");
const localEnvironment = template
  .replace(/^BETTER_AUTH_SECRET=.*$/m, `BETTER_AUTH_SECRET=${secret}`);

writeFileSync(localPath, localEnvironment, { mode: 0o600, flag: "wx" });
process.stdout.write("Created apps/web/.env.local with a unique local authentication secret.\n");
