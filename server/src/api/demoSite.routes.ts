import { Router, type Request, type Response } from "express";
import type { DemoSite } from "../../../demo-site/generate";

export function createDemoSiteRouter(site: DemoSite): Router {
  const router = Router();
  const serve = (request: Request, response: Response) => {
    const result = site.handle(request.path);
    response.setHeader("Content-Type", result.contentType);
    for (const [name, value] of Object.entries(result.headers ?? {})) response.setHeader(name, value);
    response.status(result.statusCode).send(result.body);
  };
  router.get("/", serve);
  router.get("/*", serve);
  return router;
}
