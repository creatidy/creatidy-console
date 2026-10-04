import { readFile, realpath, stat } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import MarkdownIt from "markdown-it";
import { publicFiles, root } from "./public-files.mjs";

const markdown = new MarkdownIt();

export async function validateLinks(text, document, directory, files) {
  const failures = [];
  const tokens = markdown.parse(text, {});
  async function visit(tokens, line = 1) {
    for (const token of tokens) {
      const location = token.map ? token.map[0] + 1 : line;
      const href =
        token.type === "link_open"
          ? token.attrGet("href")
          : token.type === "image"
            ? token.attrGet("src")
            : null;
      if (href !== null) {
        try {
          if (/^[a-z][a-z\d+.-]*:/i.test(href)) {
            const url = new URL(href);
            if (!["https:", "http:", "mailto:"].includes(url.protocol)) {
              throw new Error("unsupported URL scheme");
            }
          } else {
            if (href.startsWith("//")) {
              throw new Error("use an explicit external URL scheme");
            }
            if (href.includes("#") || href.includes("?")) {
              throw new Error("local fragments and queries are not supported");
            }
            const decoded = decodeURIComponent(href);
            const target = decoded.startsWith("/")
              ? resolve(directory, `.${decoded}`)
              : resolve(dirname(resolve(directory, document)), decoded);
            const path = relative(directory, target).split(sep).join("/");
            if (!files.has(path)) {
              throw new Error("target is not a current public file");
            }
            const actual = relative(
              await realpath(directory),
              await realpath(target),
            );
            if (actual.startsWith(`..${sep}`) || actual === "..") {
              throw new Error("target escapes the repository");
            }
            if (!(await stat(target)).isFile()) {
              throw new Error("target is not a file");
            }
          }
        } catch (error) {
          failures.push(`${document}:${location}: ${href}: ${error.message}`);
        }
      }
      if (token.children) await visit(token.children, location);
    }
  }
  await visit(tokens);
  return failures;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const files = new Set(await publicFiles());
  const failures = [];
  for (const file of files) {
    if (file.endsWith(".md")) {
      failures.push(
        ...(await validateLinks(
          await readFile(resolve(root, file), "utf8"),
          file,
          root,
          files,
        )),
      );
    }
  }
  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  } else {
    console.log(
      "Markdown local links are valid; external URLs were not fetched.",
    );
  }
}
