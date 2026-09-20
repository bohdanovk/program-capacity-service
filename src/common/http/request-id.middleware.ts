import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

/** Propagates a caller-supplied correlation id or mints one; it is echoed on every response and error. */
export function requestIdMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const incoming = request.header(REQUEST_ID_HEADER);
  const requestId =
    incoming !== undefined && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();

  response.setHeader(REQUEST_ID_HEADER, requestId);

  next();
}
