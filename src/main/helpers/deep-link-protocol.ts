/** The app's link scheme, as in nacho://run?shop=steam&objectId=123. */
export const DEEP_LINK_PROTOCOL = "nacho";

/** Links made before the rebrand, such as old desktop and Steam shortcuts. */
export const LEGACY_DEEP_LINK_PROTOCOL = "hydralauncher";

export const DEEP_LINK_PROTOCOLS = [
  DEEP_LINK_PROTOCOL,
  LEGACY_DEEP_LINK_PROTOCOL,
] as const;

export const isAppDeepLink = (value: string) =>
  DEEP_LINK_PROTOCOLS.some((scheme) => value.startsWith(`${scheme}://`));

export const findAppDeepLink = (args: readonly string[]) =>
  args.find(isAppDeepLink);

export const buildAppDeepLink = (host: string, query: URLSearchParams) =>
  `${DEEP_LINK_PROTOCOL}://${host}?${query.toString()}`;
