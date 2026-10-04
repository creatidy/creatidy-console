import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateLinks } from "../scripts/check-links.mjs";

let directory;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "creatidy-console-links-"));
  await writeFile(join(directory, "target.md"), "# Target\n");
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

const files = new Set(["source.md", "target.md"]);
const check = (text) => validateLinks(text, "source.md", directory, files);

describe("Markdown AST local links", () => {
  it("handles inline, reference, image, and encoded local targets", async () => {
    expect(
      await check(
        "[inline](target.md) [reference][file] ![image](target.md)\n\n[file]: target%2Emd",
      ),
    ).toEqual([]);
  });

  it("ignores code examples and never fetches external URLs", async () => {
    expect(
      await check(
        "`[example](missing.md)`\n\n```md\n[example](missing.md)\n```\n\n[external](https://example.invalid/never-fetched#heading)",
      ),
    ).toEqual([]);
  });

  it("rejects missing files, outside targets, local anchors, and bad escapes", async () => {
    for (const href of [
      "missing.md",
      "../target.md",
      "target.md#heading",
      "#heading",
      "target%xx.md",
      "//example.invalid/file",
    ]) {
      expect(await check(`[invalid](${href})`)).toHaveLength(1);
    }
  });
});
