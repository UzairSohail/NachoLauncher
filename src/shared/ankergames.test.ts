import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ankerGamesLinkOrder,
  classifyAnkerGamesLink,
  isAnkerGamesPageUri,
} from "./ankergames.js";
import { getUriConfidence } from "./download-choice.js";
import { Downloader } from "./constants.js";

describe("AnkerGames", () => {
  it("recognises game pages only", () => {
    assert.equal(
      isAnkerGamesPageUri(
        "https://ankergames.net/game/star-wars-galactic-racer"
      ),
      true
    );
    assert.equal(
      isAnkerGamesPageUri("https://www.ankergames.net/game/neon-abyss/"),
      true
    );
    assert.equal(
      isAnkerGamesPageUri("https://ankergames.net/games-list"),
      false
    );
    assert.equal(isAnkerGamesPageUri("https://ankergames.net/game/a/b"), false);
    assert.equal(
      isAnkerGamesPageUri("https://notankergames.net/game/a"),
      false
    );
  });

  it("sorts the links a page leads to", () => {
    assert.equal(classifyAnkerGamesLink("magnet:?xt=urn:btih:abc"), "torrent");
    assert.equal(
      classifyAnkerGamesLink("https://ankergames.net/files/game.torrent"),
      "torrent"
    );
    assert.equal(
      classifyAnkerGamesLink("https://ankergames.net/dl/5", {
        filename: "Game.torrent",
      }),
      "torrent"
    );
    assert.equal(
      classifyAnkerGamesLink("https://filekeeper.net/abc123"),
      "filekeeper"
    );
    assert.equal(
      classifyAnkerGamesLink("https://anknova.dlproxy.site/download/xyz?sig=1"),
      "direct"
    );
    assert.equal(
      classifyAnkerGamesLink("https://ankergames.net/game/other"),
      null
    );
    assert.equal(classifyAnkerGamesLink("https://discord.gg/invite"), null);
    assert.equal(classifyAnkerGamesLink("javascript:void(0)"), null);
  });

  it("only sends the torrent to debrid, never peer to peer", () => {
    assert.deepEqual(ankerGamesLinkOrder("debrid"), ["torrent", "filekeeper"]);
    assert.deepEqual(ankerGamesLinkOrder("direct"), ["direct", "filekeeper"]);
    assert.deepEqual(ankerGamesLinkOrder("filekeeper"), [
      "filekeeper",
      "direct",
    ]);
  });

  it("ranks a page through debrid like a torrent", () => {
    const page = "https://ankergames.net/game/neon-abyss";
    assert.equal(getUriConfidence(page, Downloader.AllDebrid), 0);
    assert.equal(getUriConfidence(page, Downloader.AnkerGames), 1);
  });
});
