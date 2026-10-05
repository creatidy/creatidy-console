import assert from "node:assert/strict";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { build } from "vite";
import { root } from "./public-files.mjs";

const require = createRequire(import.meta.url);
const check = process.argv[2] === "--check";
if (process.argv.length > (check ? 3 : 2)) {
  throw new Error("Expected no arguments or --check");
}
const temporary = check
  ? await mkdtemp(join(tmpdir(), "creatidy-console-check-"))
  : null;
const outDir = temporary ?? resolve(root, "dist");

try {
  await build({ root, build: { outDir, emptyOutDir: true } });
  await cp(resolve(root, "LICENSE"), join(outDir, "LICENSE"));
  await cp(resolve(root, "NOTICE"), join(outDir, "NOTICE"));

  const packages = [];
  for (const name of ["react", "react-dom", "scheduler"]) {
    const packagePath = require.resolve(`${name}/package.json`);
    const metadata = JSON.parse(await readFile(packagePath, "utf8"));
    assert.equal(metadata.license, "MIT", `${name} license changed`);
    const license = await readFile(
      join(dirname(packagePath), "LICENSE"),
      "utf8",
    );
    assert.match(license, /MIT License/);
    const destination = join(outDir, "third-party-notices", name);
    await mkdir(destination, { recursive: true });
    await writeFile(join(destination, "LICENSE"), license);
    packages.push({
      name,
      version: metadata.version,
      license: metadata.license,
    });
  }
  await writeFile(
    join(outDir, "third-party-notices", "packages.json"),
    `${JSON.stringify(packages, null, 2)}\n`,
  );

  const html = await readFile(join(outDir, "index.html"), "utf8");
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<title>Creatidy Console bootstrap<\/title>/);
  assert.match(html, /<div id="root"><\/div>/);
  assert.doesNotMatch(html, /\/src\/main\.tsx/);
  const tags = html.match(/<(?:script|link)\b[^>]*>/g) ?? [];
  assert(tags.some((tag) => tag.includes('type="module"')));
  assert(tags.some((tag) => tag.includes('rel="stylesheet"')));
  for (const tag of tags) {
    const asset = /(?:src|href)="([^"]+)"/.exec(tag)?.[1];
    if (tag.includes('rel="icon"')) {
      assert.equal(asset, "data:,");
      continue;
    }
    assert(asset?.startsWith("/assets/"), `Unexpected asset: ${asset}`);
    assert(!asset.includes(".."), `Unsafe asset path: ${asset}`);
    const path = join(outDir, asset.slice(1));
    assert((await stat(path)).size > 0, `Empty asset: ${asset}`);
    if (path.endsWith(".js")) {
      const javascript = await readFile(path, "utf8");
      assert.match(javascript, /Creatidy Console bootstrap/);
      assert.match(
        javascript,
        /https:\/\/forgejo\.creatidy\.com\/Creatidy\/creatidy-console\/issues\/1/,
      );
    }
  }
  console.log(
    "Validated built HTML, referenced assets, and runtime MIT licenses.",
  );
} finally {
  if (temporary) await rm(temporary, { recursive: true, force: true });
}
