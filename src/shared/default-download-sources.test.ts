import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { planDefaultSource } from "./default-download-sources.js";

const source = { id: "x", urls: ["main", "standin"] };

describe("default download sources", () => {
  it("adds the source on a fresh install, main feed first", () => {
    assert.deepEqual(planDefaultSource(source, undefined, ["other"]), {
      kind: "add",
      urls: ["main", "standin"],
    });
  });

  it("remembers a feed the person already added", () => {
    assert.deepEqual(planDefaultSource(source, undefined, ["standin"]), {
      kind: "record",
      url: "standin",
    });
  });

  it("never re-adds a source that was removed", () => {
    assert.deepEqual(planDefaultSource(source, { url: "main" }, []), {
      kind: "none",
    });
    assert.deepEqual(planDefaultSource(source, { url: "standin" }, []), {
      kind: "none",
    });
  });

  it("moves from the stand-in to the main feed", () => {
    assert.deepEqual(
      planDefaultSource(source, { url: "standin" }, ["standin"]),
      {
        kind: "add",
        urls: ["main"],
        replaces: "standin",
      }
    );
    assert.deepEqual(
      planDefaultSource(source, { url: "standin" }, ["standin", "main"]),
      { kind: "record", url: "main" }
    );
  });
});
