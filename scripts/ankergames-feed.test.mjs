import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addListedGames,
  applyGameDetails,
  normalizeGameUrl,
  parseGameText,
  pickPagesToRead,
  sortFeed,
  titleWithVersion,
} from "./ankergames-feed-lib.mjs";

describe("AnkerGames feed", () => {
  it("keeps only game pages", () => {
    assert.equal(
      normalizeGameUrl("/game/Neon-Abyss/"),
      "https://ankergames.net/game/neon-abyss"
    );
    assert.equal(normalizeGameUrl("https://ankergames.net/games-list"), null);
    assert.equal(normalizeGameUrl("/game/a/b"), null);
  });

  it("reads size, date and version from page text", () => {
    assert.deepEqual(
      parseGameText(
        "Version: v1.3.8\nSize: 1,83 GB\nLast Updated: May 28, 2026"
      ),
      {
        fileSize: "1.83 GB",
        uploadDate: "2026-05-28T00:00:00.000Z",
        version: "1.3.8",
      }
    );
    assert.equal(
      parseGameText("Released 3 June 2026").uploadDate,
      "2026-06-03T00:00:00.000Z"
    );
    assert.deepEqual(parseGameText("nothing here"), {
      fileSize: null,
      uploadDate: null,
      version: null,
    });
  });

  it("adds a version to a title once", () => {
    assert.equal(titleWithVersion(" Neon  Abyss ", "1.2"), "Neon Abyss v1.2");
    assert.equal(titleWithVersion("Neon Abyss v1.2", "1.2"), "Neon Abyss v1.2");
    assert.equal(titleWithVersion("Neon Abyss", null), "Neon Abyss");
  });

  it("lists new games at once and keeps known ones", () => {
    const known = {
      title: "Old",
      uris: ["https://ankergames.net/game/old"],
      uploadDate: "2026-01-01T00:00:00.000Z",
      fileSize: "1 GB",
    };
    const { downloads, added } = addListedGames(
      [known],
      [
        { url: "https://ankergames.net/game/old", title: "Old renamed" },
        { url: "https://ankergames.net/game/new", title: "New" },
      ],
      "2026-11-16T00:00:00.000Z"
    );
    assert.equal(added, 1);
    assert.deepEqual(downloads[0], known);
    assert.equal(downloads[1].fileSize, "Unknown");
    assert.equal(sortFeed(downloads)[0].title, "New");
  });

  it("reads unread pages first, then the stalest", () => {
    const entry = (slug) => ({ uris: [slug] });
    assert.deepEqual(
      pickPagesToRead(
        [entry("a"), entry("b"), entry("c")],
        { a: "2026-02", c: "2026-01" },
        2
      ),
      ["b", "c"]
    );
  });

  it("updates an entry from its page", () => {
    const entry = {
      title: "Game",
      uris: ["u"],
      uploadDate: "d",
      fileSize: "Unknown",
    };
    assert.deepEqual(
      applyGameDetails(entry, {
        title: "Game",
        version: "2.0",
        fileSize: "3 GB",
        uploadDate: null,
      }),
      { title: "Game v2.0", uris: ["u"], uploadDate: "d", fileSize: "3 GB" }
    );
  });
});
