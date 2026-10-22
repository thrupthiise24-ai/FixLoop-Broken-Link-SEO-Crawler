import { Router } from "express";
import { DomainError } from "../agent/domainError";
import { sendApiError } from "./errors";

export interface DemoRouteDependencies {
  fixBrokenLink?: () => Promise<{ changed: boolean; message?: string }> | { changed: boolean; message?: string };
  reset?: () => Promise<{ changed: boolean; message?: string }> | { changed: boolean; message?: string };
}

export function createDemoRouter(deps: DemoRouteDependencies = {}): Router {
  const router = Router();
  router.post("/reset", async (_request, response) => {
    if (!deps.reset) {
      sendApiError(response, new DomainError("The demo reset is not connected.", 503, "demo_reset_not_ready"));
      return;
    }
    try {
      response.json(await deps.reset());
    } catch (error) {
      sendApiError(response, error);
    }
  });
  router.post("/fix-broken-link",  async (_request, response) => {
    if (!deps.fixBrokenLink) {
      sendApiError(response, new DomainError(
        "The demo-site toggle has not been connected yet.",
        503,
        "demo_toggle_not_ready",
      ));
      return;
    }
    try {
      const result = await deps.fixBrokenLink();
      response.json({ ...result, status: result.changed ? "fixed" : "unchanged" });
    } catch (error) {
      sendApiError(response, error);
    }
  });
  return router;
}
