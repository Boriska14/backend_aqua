import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { I18nService } from '../i18n/i18n.service';

export interface ProblemFieldError {
  field: string;
  message: string;
}

export interface ProblemDetailsBody {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  errors?: ProblemFieldError[];
  traceId: string;
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  constructor(private readonly i18n: I18nService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { id?: string }>();

    const traceId =
      (typeof request.id === 'string' && request.id) ||
      (request.headers['x-request-id'] as string | undefined) ||
      randomUUID();
    const locale = this.i18n.resolveLocale(request.headers['accept-language']);

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let detail = this.i18n.t('common.internal_error', locale);
    let title = 'Internal Server Error';
    let errors: ProblemFieldError[] | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const payload = exception.getResponse();
      title = HttpStatus[status] ?? 'Error';

      if (typeof payload === 'string') {
        detail = payload;
        code = this.defaultCodeForStatus(status);
      } else if (payload && typeof payload === 'object') {
        const obj = payload as Record<string, unknown>;
        code =
          typeof obj.code === 'string'
            ? obj.code
            : this.defaultCodeForStatus(status);

        if (Array.isArray(obj.message)) {
          code = 'VALIDATION_ERROR';
          detail = this.i18n.t('common.validation_failed', locale);
          errors = obj.message.map((msg) => ({
            field: this.extractField(String(msg)),
            message: String(msg),
          }));
        } else if (typeof obj.detail === 'string') {
          detail = obj.detail;
        } else if (typeof obj.message === 'string') {
          detail = this.i18n.t(`errors.${code}`, locale, obj.message);
        }
      }
    } else if (exception instanceof Error) {
      this.logger.error(
        `Unhandled exception [traceId=${traceId}]: ${exception.message}`,
        exception.stack,
      );
    } else {
      this.logger.error(`Unhandled unknown exception [traceId=${traceId}]`);
    }

    const body: ProblemDetailsBody = {
      type: `https://api.aquasafe.cm/errors/${code}`,
      title,
      status,
      code,
      detail,
      ...(errors ? { errors } : {}),
      traceId,
    };

    response
      .status(status)
      .setHeader('Content-Type', 'application/problem+json')
      .json(body);
  }

  private defaultCodeForStatus(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'BAD_REQUEST';
      case HttpStatus.UNAUTHORIZED:
        return 'UNAUTHORIZED';
      case HttpStatus.FORBIDDEN:
        return 'FORBIDDEN';
      case HttpStatus.NOT_FOUND:
        return 'NOT_FOUND';
      case HttpStatus.CONFLICT:
        return 'CONFLICT';
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return 'UNPROCESSABLE_ENTITY';
      case HttpStatus.TOO_MANY_REQUESTS:
        return 'TOO_MANY_REQUESTS';
      case HttpStatus.SERVICE_UNAVAILABLE:
        return 'SERVICE_UNAVAILABLE';
      default:
        return 'HTTP_ERROR';
    }
  }

  private extractField(message: string): string {
    const firstWord = message.trim().split(/\s+/)[0];
    return firstWord ? firstWord.replace(/[^a-zA-Z0-9_.]/g, '') : 'body';
  }
}
