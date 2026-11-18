import { registerEvent } from "../register-event";
import { HydraApi } from "@main/services";

interface HydraApiCallPayload {
  method: "get" | "getResponse" | "post";
  url: string;
  data?: unknown;
  params?: unknown;
  options?: {
    ifModifiedSince?: Date;
    acceptedStatuses?: number[];
    timeout?: number;
  };
}

/** The renderer's way to reach Hydra's public catalogue. */
const hydraApiCall = async (
  _event: Electron.IpcMainInvokeEvent,
  payload: HydraApiCallPayload
) => {
  const { method, url, data, params, options } = payload;
  const hydraApiOptions = {
    ...options,
    validateStatus: options?.acceptedStatuses
      ? (status: number) => options.acceptedStatuses?.includes(status) ?? false
      : undefined,
  };

  const getErrorMessage = (error: unknown): string | null => {
    if (typeof error === "object" && error !== null) {
      const response = (
        error as { response?: { data?: { message?: unknown } } }
      ).response;
      const responseMessage = response?.data?.message;

      if (typeof responseMessage === "string") {
        return responseMessage;
      }
    }

    if (error instanceof Error && error.message) {
      return error.message;
    }

    return null;
  };

  try {
    let request: Promise<unknown>;

    switch (method) {
      case "get":
        request = HydraApi.get(url, params, hydraApiOptions);
        break;
      case "getResponse":
        request = HydraApi.getResponse(url, params, hydraApiOptions).then(
          ({ status, data }) => ({ status, data })
        );
        break;
      case "post":
        request = HydraApi.post(url, data, hydraApiOptions);
        break;
      default:
        throw new Error(`Unsupported HTTP method: ${method}`);
    }

    return await request;
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    throw new Error(errorMessage ?? "hydra-api-call-failed");
  }
};

registerEvent("hydraApiCall", hydraApiCall);
