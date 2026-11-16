import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isCloudflareChallenge,
  isRomsFunPageUri,
  parseRomsFunDirectLink,
  parseRomsFunDownloadPage,
  parseRomsFunFilePages,
  parseRomsFunSearch,
  pickRomsFunFile,
  rankRomsFunResults,
  toRomsFunConsole,
} from "./romsfun.js";

describe("RomsFun", () => {
  it("recognises game and download pages only", () => {
    assert.equal(
      isRomsFunPageUri("https://romsfun.com/roms/xbox/black-2.html"),
      true
    );
    assert.equal(
      isRomsFunPageUri("https://romsfun.com/download/black-12345"),
      true
    );
    assert.equal(
      isRomsFunPageUri("https://romsfun.com/download/black-12345/1"),
      true
    );
    assert.equal(isRomsFunPageUri("https://romsfun.com/roms/xbox/"), false);
    assert.equal(
      isRomsFunPageUri("https://notromsfun.com/roms/xbox/a.html"),
      false
    );
  });

  it("maps catalog codes and platform names to consoles", () => {
    assert.equal(toRomsFunConsole("xbox"), "xbox");
    assert.equal(toRomsFunConsole("Microsoft Xbox"), "xbox");
    assert.equal(toRomsFunConsole("x360"), "xbox-360");
    assert.equal(toRomsFunConsole("Sony Playstation 2"), "playstation-2");
    assert.equal(toRomsFunConsole("gc"), "gamecube");
    assert.equal(toRomsFunConsole("Nintendo 64"), "nintendo-64");
    assert.equal(toRomsFunConsole("Atari Jaguar"), null);
    assert.equal(toRomsFunConsole(null), null);
  });

  it("reads search results, keeping the name over the cover link", () => {
    const html = `
      <a href="https://romsfun.com/roms/xbox/burnout-3-takedown.html"><img alt=""></a>
      <a href="https://romsfun.com/roms/xbox/burnout-3-takedown.html">Burnout 3: Takedown</a>
      <a href="/roms/playstation-2/burnout-3-takedown-2.html" title="Burnout 3: Takedown ROM &amp; ISO - PS2 Game"></a>
      <a href="https://romsfun.com/roms/xbox/">Xbox</a>`;
    assert.deepEqual(parseRomsFunSearch(html), [
      {
        url: "https://romsfun.com/roms/xbox/burnout-3-takedown.html",
        title: "Burnout 3: Takedown",
        console: "xbox",
      },
      {
        url: "https://romsfun.com/roms/playstation-2/burnout-3-takedown-2.html",
        title: "Burnout 3: Takedown",
        console: "playstation-2",
      },
    ]);
  });

  it("ranks the right console and name first", () => {
    const results = [
      {
        url: "https://romsfun.com/roms/playstation-2/burnout-3-takedown-2.html",
        title: "Burnout 3: Takedown",
        console: "playstation-2",
      },
      {
        url: "https://romsfun.com/roms/xbox/burnout-revenge.html",
        title: "Burnout Revenge",
        console: "xbox",
      },
      {
        url: "https://romsfun.com/roms/xbox/burnout-3-takedown.html",
        title: "Burnout 3: Takedown",
        console: "xbox",
      },
      {
        url: "https://romsfun.com/roms/nes/tetris.html",
        title: "Tetris",
        console: "nes",
      },
    ];
    assert.deepEqual(
      rankRomsFunResults(results, "Burnout 3: Takedown", "xbox").map(
        (result) => result.url
      ),
      [
        "https://romsfun.com/roms/xbox/burnout-3-takedown.html",
        "https://romsfun.com/roms/xbox/burnout-revenge.html",
        "https://romsfun.com/roms/playstation-2/burnout-3-takedown-2.html",
      ]
    );
  });

  it("follows game page, file list and file page links", () => {
    const page = "https://romsfun.com/roms/xbox/burnout-3-takedown.html";
    assert.equal(
      parseRomsFunDownloadPage(
        `<a href="https://romsfun.com/download/burnout-3-takedown-77">Download ROM</a>`,
        page
      ),
      "https://romsfun.com/download/burnout-3-takedown-77"
    );

    const list = "https://romsfun.com/download/burnout-3-takedown-77";
    const files = parseRomsFunFilePages(
      `<a href="${list}/1">Burnout 3 - Takedown (Europe).zip</a>
       <a href="${list}/2">Burnout 3 - Takedown (USA).zip</a>
       <a href="${list}/3">Burnout 3 - Takedown (USA) (Demo).zip</a>`,
      list
    );
    assert.equal(files.length, 3);
    assert.equal(pickRomsFunFile(files)?.url, `${list}/2`);
    assert.equal(
      pickRomsFunFile(files, "Burnout 3 disc (Xbox, Europe)")?.url,
      `${list}/1`
    );

    assert.equal(
      parseRomsFunDirectLink(
        `<a class="btn" id="download-link" href="https://dl.example.net/f/Burnout%203.zip?t=1">Download</a>`,
        `${list}/2`
      ),
      "https://dl.example.net/f/Burnout%203.zip?t=1"
    );
    assert.equal(parseRomsFunDirectLink(`<a href="/x">x</a>`, list), null);
  });

  it("spots a Cloudflare check", () => {
    assert.equal(
      isCloudflareChallenge("<title>Just a moment...</title>"),
      true
    );
    assert.equal(isCloudflareChallenge("<title>RomsFun</title>"), false);
    assert.equal(
      isCloudflareChallenge(
        '<title>You searched for Burnout 3 Takedown | ROMSFUN.COM</title><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script>'
      ),
      false
    );
    assert.equal(
      isCloudflareChallenge('<form id="challenge-form" action="/"></form>'),
      true
    );
  });
});
