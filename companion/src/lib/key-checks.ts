/**
 * Checks a key with its service before it is saved, the same way Nacho
 * Launcher's Settings check it, so a typo shows up here and not later on a
 * computer. Each check talks only to that key's own service.
 */

export type KeyCheck =
  | { ok: true; account: string | null }
  | { ok: false; message: string };

const TIMEOUT_MS = 15_000;
const AGENT = "NachoCompanion";

class Unreachable extends Error {}

const get = async (url: string, headers: Record<string, string> = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    const body: unknown = await response.json().catch(() => null);
    return { status: response.status, body: body as Record<string, any> | null };
  } catch {
    throw new Unreachable();
  } finally {
    clearTimeout(timer);
  }
};

const rejected = (service: string): KeyCheck => ({
  ok: false,
  message: `${service} didn't accept that key. Check it and try again.`,
});

const unreachable = (service: string): KeyCheck => ({
  ok: false,
  message: `Couldn't reach ${service} to check the key. Check your connection and try again.`,
});

const run = async (service: string, check: () => Promise<KeyCheck>) => {
  try {
    return await check();
  } catch (error) {
    if (error instanceof Unreachable) return unreachable(service);
    throw error;
  }
};

const bearer = (key: string) => ({ Authorization: `Bearer ${key}` });
const query = (params: Record<string, string>) => new URLSearchParams(params).toString();

export const checkAllDebrid = (key: string) =>
  run("AllDebrid", async () => {
    const { body } = await get(
      `https://api.alldebrid.com/v4/user?${query({ agent: AGENT, apikey: key })}`,
      bearer(key)
    );
    if (body?.status !== "success") return rejected("AllDebrid");
    return { ok: true, account: body.data?.user?.username ?? null };
  });

export const checkRealDebrid = (key: string) =>
  run("Real-Debrid", async () => {
    const { status, body } = await get(
      "https://api.real-debrid.com/rest/1.0/user",
      bearer(key)
    );
    if (status < 200 || status >= 300 || !body) return rejected("Real-Debrid");
    // The launcher turns free accounts away too: they can't fetch downloads.
    if (body.type === "free") {
      return {
        ok: false,
        message: `${body.username ?? "This"} is a free Real-Debrid account. Nacho Launcher needs a premium one.`,
      };
    }
    return { ok: true, account: body.username ?? null };
  });

export const checkTorBox = (key: string) =>
  run("TorBox", async () => {
    const { status, body } = await get(
      "https://api.torbox.app/v1/api/user/me",
      bearer(key)
    );
    if (status < 200 || status >= 300 || body?.success === false || !body?.data) {
      return rejected("TorBox");
    }
    return { ok: true, account: body.data.email ?? null };
  });

export const checkPremiumize = (key: string) =>
  run("Premiumize", async () => {
    const { body } = await get(
      `https://www.premiumize.me/api/account/info?${query({ apikey: key })}`
    );
    if (body?.status !== "success") return rejected("Premiumize");
    return {
      ok: true,
      account: body.customer_id ? `customer ${body.customer_id}` : null,
    };
  });

/** Asks for one icon of a known Steam game, as the launcher does. */
export const checkSteamGridDb = (key: string) =>
  run("SteamGridDB", async () => {
    const { status } = await get(
      "https://www.steamgriddb.com/api/v2/icons/steam/1245620?limit=1",
      bearer(key)
    );
    if (status === 401 || status === 403) return rejected("SteamGridDB");
    if ((status >= 200 && status < 300) || status === 404) {
      return { ok: true, account: null };
    }
    return unreachable("SteamGridDB");
  });

export const checkRetroAchievements = (username: string, key: string) =>
  run("RetroAchievements", async () => {
    const { status, body } = await get(
      `https://retroachievements.org/API/API_GetUserProfile.php?${query({ u: username, y: key })}`
    );
    if (status === 401 || status === 403 || (status < 300 && !body?.User)) {
      return {
        ok: false,
        message:
          "RetroAchievements didn't accept that username and Web API key. Check both and try again.",
      };
    }
    if (status >= 300) return unreachable("RetroAchievements");
    return { ok: true, account: String(body?.User) };
  });
