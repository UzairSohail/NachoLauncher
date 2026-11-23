import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fileDitchPageCandidates,
  isFileDitchUri,
  isSignedFileDitchLink,
  normalizeFileDitchUrl,
  parseFileDitchPage,
} from "./fileditch.js";

describe("FileDitch links", () => {
  it("recognises file pages on FileDitch's domains", () => {
    assert.equal(
      isFileDitchUri("https://fileditchfiles.me/file.php?f=/b71/abc.mp4"),
      true
    );
    assert.equal(
      isFileDitchUri("https://fileditchvids.st/beta22/1e34db/Game.part1.rar"),
      true
    );
    assert.equal(
      isFileDitchUri(
        "https://itsfileditchfiles.st/alpha42/27a4324cacfe3df84b4f/DREADMOOR-SteamRIP.com.rar"
      ),
      true
    );
    assert.equal(isFileDitchUri("https://theditch.st/wtk8hvwb"), true);
    assert.equal(isFileDitchUri("https://fileditchhot.st/s21/x/y.zip"), true);
    assert.equal(
      isFileDitchUri("https://fileditchalbums.st/pbxrzgde8g"),
      false
    );
    assert.equal(isFileDitchUri("https://fileditchfiles.me/"), false);
    assert.equal(isFileDitchUri("https://notditch.com/a/b"), false);
  });

  it("normalises file.php links, doubled slashes and tracking", () => {
    assert.deepEqual(
      normalizeFileDitchUrl(
        "https://fileditchfiles.me//file.php?f=/b70/jRuBeGZlRoBWPurUARg.mp4"
      ),
      {
        url: "https://fileditchfiles.me/b70/jRuBeGZlRoBWPurUARg.mp4",
        kind: "page",
      }
    );
    assert.deepEqual(
      normalizeFileDitchUrl("https://fileditchfiles.me/beta5/a29/x.rar?fdrh=1"),
      { url: "https://fileditchfiles.me/beta5/a29/x.rar", kind: "page" }
    );
    assert.equal(
      normalizeFileDitchUrl("https://theditch.st/wtk8hvwb").kind,
      "short"
    );
    assert.equal(
      normalizeFileDitchUrl("https://fileditchhot.st/s21/a/b.zip").kind,
      "hotlink"
    );
  });

  it("tries the embed domain first for videos only", () => {
    assert.deepEqual(
      fileDitchPageCandidates("https://fileditchfiles.me/b71/abc.mp4"),
      [
        "https://embedditch.st/b71/abc.mp4",
        "https://fileditchfiles.me/b71/abc.mp4",
      ]
    );
    assert.deepEqual(
      fileDitchPageCandidates("https://fileditchfiles.me/b71/game.rar"),
      ["https://fileditchfiles.me/b71/game.rar"]
    );
  });

  it("accepts only signed file links", () => {
    assert.equal(
      isSignedFileDitchLink("https://n1.fd.st/b/x.rar?exp=1769407080&sig=abc"),
      true
    );
    assert.equal(
      isSignedFileDitchLink("https://n1.fd.st/b/x.rar?md5=abc&expires=17694"),
      true
    );
    const token = btoa("1769407080:sig123:3/b71/x.rar")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    assert.equal(isSignedFileDitchLink(`https://node7.fd.st/${token}`), true);
    assert.equal(
      isSignedFileDitchLink(
        "https://fileditchfiles.me/s21/FHVZKQyAZlIsrneDAsp.jpeg"
      ),
      false
    );
  });
});

describe("FileDitch pages", () => {
  it("reads the download button", () => {
    const state = parseFileDitchPage(
      `<form><input type="hidden" name="l"><button class="lang">EN</button></form>
       <a class="btn primary" download href="https://n1.fd.st/b/x.rar?exp=1&amp;sig=2">Download</a>`
    );
    assert.equal(state.downloadHref, "https://n1.fd.st/b/x.rar?exp=1&sig=2");
    assert.equal(state.challenged, false);
    assert.equal(state.gone, false);
  });

  it("spots the human check, removed files and short links", () => {
    assert.equal(
      parseFileDitchPage(
        `<form method="post"><input type="hidden" name="pow" value="1"></form>`
      ).challenged,
      true
    );
    assert.equal(
      parseFileDitchPage(`<div class="gone-path">Removed</div>`).gone,
      true
    );
    assert.equal(
      parseFileDitchPage(
        `<a id="fd-go" href="https://fileditchvids.st/beta22/a/b.mkv">Go</a>`
      ).shortLinkHref,
      "https://fileditchvids.st/beta22/a/b.mkv"
    );
  });
});
