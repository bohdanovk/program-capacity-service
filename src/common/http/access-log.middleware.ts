import { Logger } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { REQUEST_ID_HEADER } from './request-id.middleware';

const logger = new Logger('Http');

/** Set on the request by the API-key guard; typed structurally so this layer does not depend on auth. */
interface WithPrincipal {
  principal?: { readonly name: string };
}

/**
 * One line per finished request: method, path, status, duration, the client name that
 * authenticated (or "-") and the request id. Health probes log at debug so they do not
 * drown everything else.
 */
export function accessLogMiddleware(
  request: Request & WithPrincipal,
  response: Response,
  next: NextFunction,
): void {
  const startedAt = process.hrtime.bigint();

  response.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    const client = request.principal?.name ?? '-';
    const requestId = String(response.getHeader(REQUEST_ID_HEADER) ?? '');
    const line =
      `${request.method} ${request.originalUrl} ${response.statusCode} ` +
      `${durationMs.toFixed(1)}ms client=${client} requestId=${requestId}`;

    if (request.path === '/health') {
      logger.debug(line);
    } else {
      logger.log(line);
    }
  });

  next();
}
