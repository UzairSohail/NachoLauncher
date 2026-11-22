import axios, { AxiosInstance } from "axios";
import { networkLogger as logger } from "./logger";
import { appVersion } from "@main/constants";
import {
  sanitizeNetworkLogPayload,
  summarizeNetworkLogPayload,
} from "./network-log-payload";
import { summarizeNetworkError } from "./network-error-summary";

/*
 * Hydra's public catalogue is the only Hydra service Nacho still uses: game
 * search and details, assets, stats, achievement definitions, download
 * source matching, ROM and recompilation lists, and the PS4 PKG keys. There
 * is no Hydra account, so nothing here signs in or sends a token. Feature
 * switches, ProtonDB, the Decky plugin and the renderer no longer come from
 * Hydra.
 */

declare module "axios" {
  interface AxiosRequestConfig {
    logResponseBody?: boolean;
  }
}

export interface HydraApiOptions {
  ifModifiedSince?: Date;
  ifNoneMatch?: string;
  validateStatus?: (status: number) => boolean;
  signal?: AbortSignal;
  logResponseBody?: boolean;
  timeout?: number;
}

export class HydraApi {
  private static instance: AxiosInstance;
  private static readonly ADD_LOG_INTERCEPTOR = true;

  static setupApi() {
    this.instance = axios.create({
      baseURL: import.meta.env.MAIN_VITE_API_URL,
      headers: { "User-Agent": `Nacho Launcher v${appVersion}` },
    });

    if (!this.ADD_LOG_INTERCEPTOR) return;

    this.instance.interceptors.request.use(
      (request) => {
        logger.log(" ---- REQUEST -----");
        logger.log(
          request.method,
          request.url,
          sanitizeNetworkLogPayload({
            params: request.params ?? null,
            data: request.data ?? null,
          })
        );
        return request;
      },
      (error) => {
        logger.error("request error", summarizeNetworkError(error));
        return Promise.reject(error);
      }
    );
    this.instance.interceptors.response.use(
      (response) => {
        logger.log(" ---- RESPONSE -----");
        logger.log(
          response.status,
          response.config.method,
          response.config.url,
          response.config.logResponseBody === false
            ? summarizeNetworkLogPayload(response.data)
            : sanitizeNetworkLogPayload(response.data)
        );
        return response;
      },
      (error) => {
        logger.error(" ---- RESPONSE ERROR -----");
        const config = error.config ?? {};

        logger.error(
          config.method,
          config.baseURL,
          config.url,
          sanitizeNetworkLogPayload({ data: config.data ?? null })
        );
        if (error.response) {
          logger.error(
            "Response error:",
            error.response.status,
            sanitizeNetworkLogPayload(error.response.data)
          );
          return Promise.reject(error as Error);
        }

        if (error.request) {
          const errorData = error.toJSON();
          logger.error("Request error:", summarizeNetworkError(error));
          // Keep the code so callers can tell a timeout from going offline.
          return Promise.reject(
            Object.assign(
              new Error(
                `Request failed with ${errorData.code} ${errorData.message}`
              ),
              { code: errorData.code }
            )
          );
        }

        logger.error("Error", summarizeNetworkError(error));
        return Promise.reject(error as Error);
      }
    );
  }

  private static requestConfig(options?: HydraApiOptions) {
    return {
      signal: options?.signal,
      timeout: options?.timeout,
      logResponseBody: options?.logResponseBody,
      ...(options?.validateStatus
        ? { validateStatus: options.validateStatus }
        : {}),
    };
  }

  private static getConfig(params: unknown, options?: HydraApiOptions) {
    return {
      ...this.requestConfig(options),
      params,
      headers: {
        "Hydra-If-Modified-Since": options?.ifModifiedSince?.toUTCString(),
        "If-None-Match": options?.ifNoneMatch,
      },
    };
  }

  static async get<T = any>(
    url: string,
    params?: any,
    options?: HydraApiOptions
  ): Promise<T> {
    const response = await this.instance.get<T>(
      url,
      this.getConfig(params, options)
    );
    return response.data;
  }

  static async getResponse<T = any>(
    url: string,
    params?: any,
    options?: HydraApiOptions
  ) {
    const response = await this.instance.get<T>(
      url,
      this.getConfig(params, options)
    );
    return {
      status: response.status,
      data: response.data,
      headers: response.headers,
    };
  }

  static async post<T = any>(
    url: string,
    data?: any,
    options?: HydraApiOptions
  ): Promise<T> {
    const response = await this.instance.post<T>(
      url,
      data,
      this.requestConfig(options)
    );
    return response.data;
  }

  static async checkDownloadSourcesChanges(
    downloadSourceIds: string[],
    games: Array<{ shop: string; objectId: string }>,
    since: string
  ) {
    return this.post<
      Array<{
        shop: string;
        objectId: string;
        newDownloadOptionsCount: number;
        downloadSourceIds: string[];
      }>
    >("/download-sources/changes", { downloadSourceIds, games, since });
  }
}
