export interface LogContext {
  correlationId?: string;
  tenantId?: string;
  service: string;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface StructuredLog {
  correlationId: string;
  tenantId: string;
  service: string;
  timestamp: string;
  level: LogLevel;
  message: string;
  [key: string]: unknown;
}

export class Logger {
  constructor(private readonly context: LogContext) {}

  private emit(level: LogLevel, message: string, extra?: Record<string, unknown>) {
    const entry: StructuredLog = {
      correlationId: this.context.correlationId ?? '',
      tenantId: this.context.tenantId ?? '',
      service: this.context.service,
      timestamp: new Date().toISOString(),
      level,
      message,
      ...extra,
    };
    const line = JSON.stringify(entry);
    if (level === 'error') {
      process.stderr.write(line + '\n');
    } else {
      process.stdout.write(line + '\n');
    }
  }

  debug(message: string, extra?: Record<string, unknown>) { this.emit('debug', message, extra); }
  info(message: string, extra?: Record<string, unknown>) { this.emit('info', message, extra); }
  warn(message: string, extra?: Record<string, unknown>) { this.emit('warn', message, extra); }
  error(message: string, extra?: Record<string, unknown>) { this.emit('error', message, extra); }

  child(overrides: Partial<LogContext>): Logger {
    return new Logger({ ...this.context, ...overrides });
  }
}

export function createLogger(service: string): Logger {
  return new Logger({ service });
}
