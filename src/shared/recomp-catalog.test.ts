import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  findCatalogEntriesForGame,
  fromCatalogSlug,
  guessAssetOs,
  manifestExecutable,
  manifestToRomMeta,
  matchesAssetPattern,
  normalizeGameTitle,
  parseRecompCatalog,
  pickCatalogueGameForRecomp,
  toCatalogItem,
  toCatalogDetails,
  toCatalogReleases,
  toCatalogSummary,
} from "./recomp-catalog.js";

const zelda = {
  id: "zelda64recomp",
  name: "Zelda 64: Recompiled",
  game: "The Legend of Zelda: Majora's Mask",
  origin: "n64",
  repo: "Zelda64Recomp/Zelda64Recomp",
  version: "1.2.2",
  tag: "v1.2.2",
  released: "2025-08-27",
  systems: ["windows", "linux", "macos"],
  assets: {
    windows: "Zelda64Recompiled-*-Windows.zip",
    linux: "Zelda64Recompiled-*-Linux-X64.zip",
  },
  icon: "https://recompstore.com/media/icon.png",
  cover: "https://recompstore.com/media/cover.jpg",
  about: { name: "The Legend of Zelda: Majora's Mask" },
  needs: "Your own copy of The Legend of Zelda: Majora's Mask",
};

const dusklightManifest = {
  format: 1,
  game: {
    kind: "iso",
    label: "Your Twilight Princess disc image",
    check: { ids: ["GZ2E"] },
  },
  start: {
    program: ["Dusklight.exe", "Dusklight.AppImage"],
    args: ["--dvd", "{game}"],
  },
};

const dusklight = {
  id: "dusklight",
  name: "Dusklight",
  game: "The Legend of Zelda: Twilight Princess",
  origin: "gc",
  repo: "TwilitRealm/dusklight",
  tag: "v2.0.3",
  launcher: dusklightManifest,
};

const catalog = {
  apps: [
    zelda,
    dusklight,
    { id: "soon-game", name: "Soon", repo: "a/b", soon: true },
    { id: "gitlab-game", name: "GitLab", repo: "gitlab:group/project" },
    { id: "../escape", name: "Bad", repo: "a/b" },
    { ...zelda, name: "Duplicate" },
  ],
};

const release = (tag: string, assets: string[], extra = {}) => ({
  tag_name: tag,
  name: tag,
  published_at: "2025-08-27T00:00:00Z",
  html_url: `https://github.com/Zelda64Recomp/Zelda64Recomp/releases/tag/${tag}`,
  prerelease: false,
  draft: false,
  assets: assets.map((name) => ({
    name,
    size: 10,
    download_count: 1,
    browser_download_url: `https://github.com/Zelda64Recomp/Zelda64Recomp/releases/download/${tag}/${name}`,
    digest: `sha256:${"a".repeat(64)}`,
  })),
  ...extra,
});

describe("parseRecompCatalog", () => {
  it("keeps installable GitHub entries once each", () => {
    const entries = parseRecompCatalog(catalog);
    assert.deepEqual(
      entries.map((entry) => entry.id),
      ["zelda64recomp", "dusklight"]
    );
  });

  it("returns nothing for data that isn't a catalog", () => {
    assert.deepEqual(parseRecompCatalog(null), []);
    assert.deepEqual(parseRecompCatalog({ apps: "nope" }), []);
  });
});

describe("matching a game page", () => {
  const entries = parseRecompCatalog(catalog);

  it("ignores case, punctuation and a leading article", () => {
    assert.equal(
      normalizeGameTitle("The Legend of Zelda: Majora's Mask (USA)"),
      "legend of zelda majora s mask"
    );
  });

  it("finds the entries for the same game", () => {
    for (const title of [
      "Legend of Zelda: Majora’s Mask",
      "The Legend of Zelda - Majora's Mask",
    ]) {
      assert.deepEqual(
        findCatalogEntriesForGame(entries, title).map((entry) => entry.id),
        ["zelda64recomp"]
      );
    }
  });

  it("finds nothing for another game", () => {
    assert.deepEqual(findCatalogEntriesForGame(entries, "Super Metroid"), []);
  });
});

describe("catalog slugs", () => {
  it("round-trips the catalog id", () => {
    const summary = toCatalogSummary(parseRecompCatalog(catalog)[0]);
    assert.equal(summary.slug, "rl-zelda64recomp");
    assert.equal(fromCatalogSlug(summary.slug), "zelda64recomp");
    assert.equal(fromCatalogSlug("zelda64recomp"), null);
  });

  it("builds details for the game page it was opened from", () => {
    const details = toCatalogDetails(
      parseRecompCatalog(catalog)[0],
      "1234",
      "2026-11-16T00:00:00.000Z"
    );
    assert.equal(details.game.objectId, "1234");
    assert.equal(details.repository.fullName, "Zelda64Recomp/Zelda64Recomp");
    assert.equal(details.tested.level, "untested");
  });
});

describe("releases", () => {
  const entry = parseRecompCatalog(catalog)[0];

  it("matches catalog patterns", () => {
    assert.ok(
      matchesAssetPattern(
        "Zelda64Recompiled-v1.2.2-Windows.zip",
        "Zelda64Recompiled-*-Windows.zip"
      )
    );
    assert.ok(!matchesAssetPattern("Other-Windows.zip", "Zelda64Recompiled-*"));
  });

  it("guesses the system from a file name", () => {
    assert.equal(guessAssetOs("Game-Linux-x64.AppImage"), "linux");
    assert.equal(guessAssetOs("Game-macOS.zip"), "macos");
    assert.equal(guessAssetOs("Game-win64.zip"), "windows");
    assert.equal(guessAssetOs("Source.zip"), null);
  });

  it("marks the pattern's file as the install target", () => {
    const [latest] = toCatalogReleases(entry, [
      release("v1.2.2", [
        "Zelda64Recompiled-v1.2.2-Windows.zip",
        "Zelda64Recompiled-v1.2.2-Windows-debug.zip",
        "Zelda64Recompiled-v1.2.2-Linux-X64.zip",
        "Zelda64Recompiled-v1.2.2-Linux-ARM64.zip",
      ]),
    ]);
    const targets = latest.assets.filter((asset) => asset.isInstallTarget);
    assert.deepEqual(
      targets.map((asset) => asset.name),
      [
        "Zelda64Recompiled-v1.2.2-Windows.zip",
        "Zelda64Recompiled-v1.2.2-Linux-X64.zip",
      ]
    );
    assert.equal(targets[0].sha256, "a".repeat(64));
    assert.ok(latest.isLatest);
    assert.equal(latest.version, "1.2.2");
  });

  it("falls back to the best file when the pattern matches none", () => {
    const [latest] = toCatalogReleases(entry, [
      release("v1.2.2", [
        "Zelda64Recompiled-1.2.2-windows-x64-setup.exe",
        "Zelda64Recompiled-1.2.2-linux-x86_64.AppImage",
      ]),
    ]);
    assert.deepEqual(
      latest.assets
        .filter((asset) => asset.isInstallTarget)
        .map((asset) => asset.name),
      [
        "Zelda64Recompiled-1.2.2-windows-x64-setup.exe",
        "Zelda64Recompiled-1.2.2-linux-x86_64.AppImage",
      ]
    );
  });

  it("keeps the catalog's pinned tag as latest over a newer release", () => {
    const releases = toCatalogReleases(entry, [
      release("v1.3.0", ["Zelda64Recompiled-v1.3.0-Windows.zip"]),
      release("v1.2.2", ["Zelda64Recompiled-v1.2.2-Windows.zip"]),
    ]);
    assert.deepEqual(
      releases.map((item) => item.isLatest),
      [false, true]
    );
  });

  it("never takes a pre-release or draft as latest without a pin", () => {
    const unpinned = { ...entry, tag: null };
    const releases = toCatalogReleases(unpinned, [
      release("v2.0.0-beta", ["Game-Windows.zip"], { prerelease: true }),
      release("v1.9.0", ["Game-Windows.zip"], { draft: true }),
      release("v1.8.0", ["Game-Windows.zip"]),
    ]);
    assert.deepEqual(
      releases.map((item) => [item.tag, item.isLatest]),
      [
        ["v2.0.0-beta", false],
        ["v1.8.0", true],
      ]
    );
  });

  it("picks an AppImage over a zip on Linux without a pattern", () => {
    const unpinned = { ...entry, assets: {} };
    const [latest] = toCatalogReleases(unpinned, [
      release("v1.0.0", ["Game-Linux.zip", "Game-Linux.AppImage"]),
    ]);
    assert.deepEqual(
      latest.assets
        .filter((asset) => asset.isInstallTarget)
        .map((asset) => asset.name),
      ["Game-Linux.AppImage"]
    );
  });
});

describe("developer manifests", () => {
  it("hands a disc image to the port through its arguments", () => {
    const meta = manifestToRomMeta(dusklightManifest as never, "gc");
    assert.deepEqual(meta?.path?.arg, ["--dvd", "{rom}"]);
    assert.ok(meta?.extensions.includes(".rvz"));
  });

  it("writes the game's path into a JSON config", () => {
    const meta = manifestToRomMeta(
      {
        game: { kind: "iso" },
        config: [
          {
            format: "json",
            file: [
              { path: "{install}/portable.json", if: "{install}/portable" },
              { path: "{config}/MyGame/config.json" },
            ],
            game_path: "backend.isoPath",
          },
        ],
      },
      "ps2"
    );
    assert.deepEqual(meta?.path?.config, {
      file: {
        win32: "<winAppData>/MyGame/config.json",
        linux: "<xdgConfig>/MyGame/config.json",
      },
      key: ["backend", "isoPath"],
    });
  });

  it("needs a game file for a folder game", () => {
    assert.equal(
      manifestToRomMeta(
        { game: { kind: "folder" }, start: { args: ["{game}"] } },
        "ps4"
      ),
      null
    );
    const meta = manifestToRomMeta(
      {
        game: { kind: "folder", check: { file: "eboot.bin" } },
        start: { args: ["--game", "{game}"] },
      },
      "ps4"
    );
    assert.deepEqual(meta?.folder, ["eboot.bin"]);
  });

  it("skips a manifest that can't hand the game over", () => {
    assert.equal(manifestToRomMeta({ game: { kind: "iso" } }, "n64"), null);
    assert.equal(
      manifestToRomMeta({ start: { args: ["{game}"] } }, "n64"),
      null
    );
    assert.equal(
      manifestToRomMeta(
        { game: { kind: "iso" }, start: { args: ["{documents}/{game}"] } },
        "n64"
      ),
      null
    );
  });

  it("picks the program for this system", () => {
    assert.equal(
      manifestExecutable(dusklightManifest as never, "win32"),
      "Dusklight.exe"
    );
    assert.equal(
      manifestExecutable(dusklightManifest as never, "linux"),
      "Dusklight.AppImage"
    );
    assert.equal(
      manifestExecutable({ start: { program: ["../evil.exe"] } }, "win32"),
      null
    );
  });
});

describe("browsing the catalog", () => {
  const [zeldaEntry, dusklightEntry] = parseRecompCatalog(catalog);

  it("lists each entry with its slug and setup state", () => {
    const item = toCatalogItem(dusklightEntry);
    assert.equal(item.slug, "rl-dusklight");
    assert.equal(item.hasEasySetup, true);
    assert.equal(toCatalogItem(zeldaEntry).hasEasySetup, false);
  });

  it("finds the catalogue game on the recomp's own console", () => {
    const match = pickCatalogueGameForRecomp(
      [
        { objectId: "1", title: "Zelda Majora", platform: "Nintendo 64" },
        {
          objectId: "2",
          title: "The Legend of Zelda: Majora's Mask",
          platform: "Nintendo 3DS",
        },
        {
          objectId: "3",
          title: "Legend of Zelda, The - Majora's Mask",
          platform: "Nintendo 64",
          alternateNames: ["The Legend of Zelda: Majora's Mask"],
        },
      ],
      toCatalogItem(zeldaEntry)
    );
    assert.equal(match?.objectId, "3");
  });

  it("finds nothing when no result is that game", () => {
    assert.equal(
      pickCatalogueGameForRecomp(
        [{ objectId: "1", title: "Zelda II", platform: "NES" }],
        toCatalogItem(zeldaEntry)
      ),
      null
    );
  });
});
