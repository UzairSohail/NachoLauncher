import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toProtonDBData } from "./protondb.js";

describe("toProtonDBData", () => {
  it("maps the ProtonDB summary and the Deck category", () => {
    assert.deepEqual(
      toProtonDBData(
        {
          tier: "gold",
          confidence: "strong",
          score: 0.71,
          total: 120,
          trendingTier: "platinum",
        },
        3
      ),
      {
        tier: "gold",
        confidence: "strong",
        score: 0.71,
        total: 120,
        trendingTier: "platinum",
        resolvedCategory: 3,
        deckCompatibility: "verified",
      }
    );
  });

  it("returns null when neither source knows the game", () => {
    assert.equal(toProtonDBData(null, null), null);
  });
});
