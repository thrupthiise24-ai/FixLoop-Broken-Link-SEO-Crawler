import type { Response } from "express";
import { DomainError } from "../agent/domainError";

export function sendApiError(response: Response, error: unknown): void {
  if (error instanceof DomainError) {
    response.status(error.statusCode).json({ error: error.code, message: error.message });
    return;
  }
  response.status(500).json({
    error: "internal_error",
    message: error instanceof Error ? error.message : "Unexpected server error.",
  });
}
