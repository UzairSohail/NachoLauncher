import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { Downloader } from "./constants.js";
import {
  getDownloadAttempts as getDownloadAttemptsWith,
  getUriConfidence,
  isAllDebridSupportedUri,
  pickDefaultDownloader,
  refreshAllDebridSupportedDomains,
  setAllDebridSupportedDomains,
  withAllDebridSupport,
} from "./download-choice.js";

// A small stand-in for getDownloadersForUri in index.ts.
const getDownloadersForUri = (uri: string): Downloader[] => {
  const base = uri.startsWith("https://gofile.io")
    ? [Downloader.Gofile]
    : uri.startsWith("https://buzzheavier.com")
      ? [Downloader.Buzzheavier]
      : [Downloader.AllDebrid, Downloader.RealDebrid];
  return withAllDebridSupport(uri, base);
};
const getDownloadAttempts = (
  repack: { uris: string[] },
  downloader: Downloader
) => getDownloadAttemptsWith(repack, downloader, getDownloadersForUri);

const listing = {
  uris: ["https://buzzheavier.com/xyz", "https://gofile.io/d/123"],
};

describe("AllDebrid supported hosts", () => {
  afterEach(() => setAllDebridSupportedDomains([]));

  it("matches a host, its www form and subdomains", () => {
    setAllDebridSupportedDomains(["gofile.io", "www.1fichier.com"]);
    assert.ok(isAllDebridSupportedUri("https://gofile.io/d/123"));
    assert.ok(isAllDebridSupportedUri("https://store1.gofile.io/x"));
    assert.ok(isAllDebridSupportedUri("https://1fichier.com/?abc"));
    assert.ok(!isAllDebridSupportedUri("https://notgofile.io/d/1"));
    assert.ok(!isAllDebridSupportedUri("magnet:?xt=urn:btih:abc"));
  });

  it("offers AllDebrid for a supported host and prefers it", () => {
    assert.deepEqual(getDownloadersForUri("https://gofile.io/d/123"), [
      Downloader.Gofile,
    ]);
    setAllDebridSupportedDomains(["gofile.io"]);
    assert.deepEqual(getDownloadersForUri("https://gofile.io/d/123"), [
      Downloader.Gofile,
      Downloader.AllDebrid,
    ]);
    assert.equal(
      getUriConfidence("https://gofile.io/d/123", Downloader.AllDebrid),
      0.5
    );
    assert.equal(
      pickDefaultDownloader(
        listing,
        [Downloader.Buzzheavier, Downloader.Gofile, Downloader.AllDebrid],
        getDownloadersForUri
      ),
      Downloader.AllDebrid
    );
  });

  it("keeps the direct host when AllDebrid doesn't list it", () => {
    setAllDebridSupportedDomains(["1fichier.com"]);
    assert.equal(
      pickDefaultDownloader(
        listing,
        [Downloader.Buzzheavier, Downloader.Gofile, Downloader.AllDebrid],
        getDownloadersForUri
      ),
      Downloader.Buzzheavier
    );
  });

  it("falls back to each host's own downloader after AllDebrid", () => {
    setAllDebridSupportedDomains(["gofile.io"]);
    assert.deepEqual(getDownloadAttempts(listing, Downloader.AllDebrid), [
      { uri: "https://gofile.io/d/123", downloader: Downloader.AllDebrid },
      {
        uri: "https://buzzheavier.com/xyz",
        downloader: Downloader.Buzzheavier,
      },
      { uri: "https://gofile.io/d/123", downloader: Downloader.Gofile },
    ]);
    assert.deepEqual(getDownloadAttempts(listing, Downloader.Gofile), [
      { uri: "https://gofile.io/d/123", downloader: Downloader.Gofile },
    ]);
  });

  it("refreshes at most every 15 minutes, retrying empty answers", async () => {
    let calls = 0;
    const fetchEmpty = async () => {
      calls++;
      return [];
    };
    assert.equal(await refreshAllDebridSupportedDomains(fetchEmpty), false);
    const fetchHosts = async () => {
      calls++;
      return ["gofile.io"];
    };
    assert.equal(await refreshAllDebridSupportedDomains(fetchHosts), true);
    assert.equal(await refreshAllDebridSupportedDomains(fetchHosts), false);
    assert.equal(calls, 2);
  });
});
