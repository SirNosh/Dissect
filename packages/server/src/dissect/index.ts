import type pino from "pino";
import { DissectService } from "./service.js";

const services = new Map<string, DissectService>();

/** Daemon-global Dissect service, one instance per data root. */
export function getDissectService(paseoHome: string, logger: pino.Logger): DissectService {
  const existing = services.get(paseoHome);
  if (existing) return existing;
  const service = new DissectService(paseoHome, logger.child({ component: "dissect" }));
  services.set(paseoHome, service);
  return service;
}

export type { DissectService } from "./service.js";
