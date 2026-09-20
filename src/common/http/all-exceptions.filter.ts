import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { DomainError, DomainErrorKind } from '../../shared/domain/domain-error';
import { ErrorResponseDto } from './error-response.dto';
import { REQUEST_ID_HEADER } from './request-id.middleware';

const STATUS_BY_KIND: Readonly<Record<DomainErrorKind, HttpStatus>> = {
  NOT_FOUND: HttpStatus.NOT_FOUND,
  CONFLICT: HttpStatus.CONFLICT,
  INVALID_INPUT: HttpStatus.BAD_REQUEST,
  UNPROCESSABLE: HttpStatus.UNPROCESSABLE_ENTITY,
};

interface Problem {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly details?: Record<string, unknown>;
}

/**
 * Translates every failure into the {@link ErrorResponseDto} envelope. Domain errors are
 * mapped by kind; framework errors keep their status; anything else is a 500 whose details
 * stay in the logs.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      this.logger.error('Unhandled non-HTTP exception', errorStack(exception));
      return;
    }
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const problem = describe(exception);

    const body: ErrorResponseDto = {
      statusCode: problem.status,
      code: problem.code,
      message: problem.message,
      ...(problem.details === undefined ? {} : { details: problem.details }),
      requestId: String(response.getHeader(REQUEST_ID_HEADER) ?? ''),
      timestamp: new Date().toISOString(),
      path: request.originalUrl,
    };

    const summary = `${request.method} ${request.originalUrl} -> ${problem.status} ${problem.code}`;
    if (problem.status >= 500) {
      this.logger.error(summary, errorStack(exception));
    } else {
      this.logger.debug(summary);
    }
    response.status(problem.status).json(body);
  }
}

function describe(exception: unknown): Problem {
  if (exception instanceof DomainError) {
    return {
      status: STATUS_BY_KIND[exception.kind],
      code: exception.code,
      message: exception.message,
      details: { ...exception.details },
    };
  }
  if (exception instanceof HttpException) {
    return describeHttpException(exception);
  }
  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    code: 'INTERNAL_ERROR',
    message: 'Internal server error',
  };
}

function describeHttpException(exception: HttpException): Problem {
  const status = exception.getStatus();
  const code = codeForStatus(status);
  const payload = exception.getResponse();
  if (typeof payload === 'string') {
    return { status, code, message: payload };
  }
  const message: unknown = (payload as { message?: unknown }).message;
  if (Array.isArray(message)) {
    // class-validator reports one line per violated constraint.
    return {
      status,
      code: 'VALIDATION_FAILED',
      message: 'Request validation failed',
      details: { violations: message },
    };
  }
  return { status, code, message: typeof message === 'string' ? message : exception.message };
}

function codeForStatus(status: number): string {
  const name = (HttpStatus as Record<number, string | undefined>)[status];
  return name ?? 'HTTP_ERROR';
}

function errorStack(exception: unknown): string | undefined {
  return exception instanceof Error ? exception.stack : String(exception);
}
