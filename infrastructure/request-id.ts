import { randomUUID } from "node:crypto";

const TRUSTED_REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const REQUEST_ID_HEADER = "x-request-id";

export function isTrustedRequestId(value: string): boolean {
  return TRUSTED_REQUEST_ID.test(value);
}

export function requestIdFromHeaders(headers?: Pick<Headers, "get">): string {
  const candidate = headers?.get(REQUEST_ID_HEADER)?.trim();
  return candidate && isTrustedRequestId(candidate) ? candidate : randomUUID();
}

export function headersWithRequestId(requestId: string): HeadersInit {
  return {
    "cache-control": "no-store",
    [REQUEST_ID_HEADER]: requestId,
  };
}
