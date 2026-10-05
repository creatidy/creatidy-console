import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import App from "../src/App";

describe("bootstrap scaffold", () => {
  it("states its limited scope in one semantic main and heading", () => {
    const html = renderToStaticMarkup(<App />);
    expect(html.match(/<main>/g)).toHaveLength(1);
    expect(html.match(/<h1>/g)).toHaveLength(1);
    expect(html).toContain("<h1>Creatidy Console bootstrap</h1>");
    expect(html).toContain(
      "No producer connections or operational tasks are available",
    );
    expect(html).not.toMatch(/<(button|input|select|textarea|form)\b/);
  });

  it("only links to the canonical bootstrap issue with new-tab protection", () => {
    const html = renderToStaticMarkup(<App />);
    expect(html.match(/<a\b/g)).toHaveLength(1);
    expect(html).toContain(
      'href="https://forgejo.creatidy.com/Creatidy/creatidy-console/issues/1"',
    );
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
    expect(html).toContain("opens in a new tab");
  });
});
