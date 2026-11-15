import { registerEvent } from "../register-event";
import { AllDebridClient } from "@main/services/download/all-debrid";
import { setAllDebridSupportedDomains } from "@shared";
import { logger } from "@main/services";

/** Domains AllDebrid can unlock right now; empty without an API key. */
const getAllDebridHosts = async () => {
  try {
    const domains = await AllDebridClient.getSupportedDomains();
    // The phone companion picks downloads in this process.
    setAllDebridSupportedDomains(domains);
    return domains;
  } catch (error) {
    logger.error("[AllDebrid] Could not load supported hosts", error);
    return [];
  }
};

registerEvent("getAllDebridHosts", getAllDebridHosts);
