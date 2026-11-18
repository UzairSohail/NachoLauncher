import type { Plugin } from "vite";
import { MONACO_VS_URL } from "../shared/monaco";

// Scripts only load from the app itself and the Monaco editor CDN.
export const contentSecurityPolicy = (): Plugin => ({
  name: "hydra:content-security-policy",
  transformIndexHtml: (_html, context) => {
    const scriptSources = [
      "'self'",
      `${MONACO_VS_URL}/`,
      // React Refresh injects an inline preamble that only exists on the dev server.
      ...(context.server ? ["'unsafe-inline'"] : []),
    ];

    return [
      {
        tag: "meta",
        attrs: {
          "http-equiv": "Content-Security-Policy",
          content: [
            "default-src 'self' 'unsafe-inline' * data: local: blob:",
            `script-src ${scriptSources.join(" ")}`,
            "worker-src 'self' blob:",
            "object-src 'none'",
            "base-uri 'self'",
            "media-src 'self' 'unsafe-inline' * data: local: blob:",
          ].join("; "),
        },
        injectTo: "head-prepend",
      },
    ];
  },
});
