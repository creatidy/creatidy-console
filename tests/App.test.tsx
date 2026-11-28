import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import App from "../src/App";

describe("Console authentication shell", () => {
  it("provides a semantic main and a recovery action while checking the session", () => {
    const html = renderToStaticMarkup(<App />);
    expect(html.match(/<main\b/g)).toHaveLength(1);
    expect(html.match(/<h1\b/g)).toHaveLength(1);
    expect(html).toContain('href="#main-content"');
    expect(html).not.toContain("Set up your console");
    expect(html).toContain("Checking the local application session");
    expect(html).toContain("Try again");
  });
});
