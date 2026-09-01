import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fieldOrderForFile } from "../src/fileclass/adapter.js";

/**
 * A stand-in for the Fileclass plugin's index. Only the two methods the adapter calls
 * are modelled; `getResolvedFields` returns fields the way the real index does — already
 * inheritance-resolved and already in the class's declared order.
 */
function appWith(
  classesByPath: Record<string, string[]>,
  fieldsByClass: Record<string, { name?: unknown; path?: unknown }[]>,
  opts: { present?: boolean; omitResolver?: boolean; throws?: boolean } = {}
) {
  const index = {
    getFileClasses: (file: { path: string }) => classesByPath[file.path] ?? [],
    ...(opts.omitResolver
      ? {}
      : {
          getResolvedFields: (name: string) => {
            if (opts.throws) throw new Error("index not ready");
            return fieldsByClass[name] ?? [];
          },
        }),
  };
  return {
    plugins: { plugins: { fileclass: opts.present === false ? undefined : { index } } },
  } as never;
}

const file = { path: "Notes/Thing.md" } as never;
const named = (...names: string[]) => names.map((name) => ({ name, path: "" }));

describe("frontmatter field order from Fileclass", () => {
  it("uses the class's declared order", () => {
    const app = appWith({ "Notes/Thing.md": ["Reference/Link"] },
      { "Reference/Link": named("url", "rating", "read", "status") });
    assert.deepEqual(fieldOrderForFile(app, file), ["url", "rating", "read", "status"]);
  });

  it("concatenates several classes in binding order, each field once", () => {
    const app = appWith({ "Notes/Thing.md": ["Note", "Action"] },
      { Note: named("created", "modified", "description"), Action: named("created", "delegable") });
    // `created` belongs to the first class that claimed it; it must not appear twice.
    assert.deepEqual(fieldOrderForFile(app, file), ["created", "modified", "description", "delegable"]);
  });

  it("skips nested Object children, which are not frontmatter keys", () => {
    const app = appWith({ "Notes/Thing.md": ["Tool"] },
      { Tool: [{ name: "steps", path: "" }, { name: "kind", path: "fcSteps" }] });
    assert.deepEqual(fieldOrderForFile(app, file), ["steps"]);
  });

  it("returns nothing for a note with no class, so the global order is kept", () => {
    const app = appWith({}, {});
    assert.deepEqual(fieldOrderForFile(app, file), []);
  });

  it("returns nothing when the plugin is absent", () => {
    const app = appWith({ "Notes/Thing.md": ["Note"] }, { Note: named("created") }, { present: false });
    assert.deepEqual(fieldOrderForFile(app, file), []);
  });

  it("returns nothing when the index predates getResolvedFields", () => {
    // An older Fileclass build must degrade to Forge's own order, not crash.
    const app = appWith({ "Notes/Thing.md": ["Note"] }, {}, { omitResolver: true });
    assert.deepEqual(fieldOrderForFile(app, file), []);
  });

  it("returns nothing when the index throws rather than propagating", () => {
    const app = appWith({ "Notes/Thing.md": ["Note"] }, {}, { throws: true });
    assert.deepEqual(fieldOrderForFile(app, file), []);
  });

  it("ignores unnamed and blank entries", () => {
    const app = appWith({ "Notes/Thing.md": ["Note"] },
      { Note: [{ name: "  ", path: "" }, { path: "" }, { name: "created", path: "" }] });
    assert.deepEqual(fieldOrderForFile(app, file), ["created"]);
  });
});
