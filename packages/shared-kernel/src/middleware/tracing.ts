import * as crypto from 'crypto';

const CORRELATION_HEADER = 'x-correlation-id';

export function getCorrelationId(headers: Record<string, string | string[] | undefined>): string {
  const existing = headers[CORRELATION_HEADER] ?? headers[CORRELATION_HEADER.toUpperCase()];
  if (typeof existing === 'string' && existing.length > 0) return existing;
  return crypto.randomUUID();
}

export function tracingMiddleware() {
  return async (request: any, _reply: any) => {
    const correlationId = getCorrelationId(request.headers ?? {});
    request.correlationId = correlationId;
    request.headers[CORRELATION_HEADER] = correlationId;
  };
}

export function correlationHeaders(correlationId: string): Record<string, string> {
  return { [CORRELATION_HEADER]: correlationId };
}
