import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import typescript from "typescript";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webRoot = path.join(repositoryRoot, "apps", "web");

function findModule(basePath) {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.mts`,
    `${basePath}.js`,
    `${basePath}.mjs`,
    `${basePath}.json`,
    path.join(basePath, "index.ts"),
    path.join(basePath, "index.tsx"),
    path.join(basePath, "index.js"),
    path.join(basePath, "index.mjs"),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "next/image") {
    const imageMock = path.join(repositoryRoot, "scripts", "test-mocks", "next-image.mjs");
    return { url: pathToFileURL(imageMock).href, shortCircuit: true };
  }

  if (specifier.startsWith("@/")) {
    const target = findModule(path.resolve(webRoot, specifier.slice(2)));
    if (target) return { url: pathToFileURL(target).href, shortCircuit: true };
  }

  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (specifier.startsWith(".") && context.parentURL?.startsWith("file:")) {
      const parentPath = fileURLToPath(context.parentURL);
      const target = findModule(path.resolve(path.dirname(parentPath), specifier));
      if (target) return { url: pathToFileURL(target).href, shortCircuit: true };
    }
    throw error;
  }
}

export async function load(url, context, nextLoad) {
  if (!url.endsWith(".tsx")) return nextLoad(url, context);

  const fileName = fileURLToPath(url);
  const source = readFileSync(fileName, "utf8");
  const transpiled = typescript.transpileModule(source, {
    fileName,
    compilerOptions: {
      jsx: typescript.JsxEmit.ReactJSX,
      module: typescript.ModuleKind.ESNext,
      target: typescript.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });

  return { format: "module", shortCircuit: true, source: transpiled.outputText };
}
