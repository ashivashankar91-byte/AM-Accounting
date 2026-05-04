export interface HealthDependency {
  status: 'ok' | 'error';
  latencyMs?: number;
  error?: string;
}

export interface HealthMetrics {
  requestsLastMinute: number;
  errorsLastMinute: number;
  avgResponseTimeMs: number;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  service: string;
  uptime: number;
  dependencies: Record<string, HealthDependency>;
  metrics: HealthMetrics;
}

export class MetricsCollector {
  private requests: number[] = [];
  private errors: number[] = [];
  private responseTimes: number[] = [];

  recordRequest(durationMs: number, isError: boolean) {
    const now = Date.now();
    this.requests.push(now);
    this.responseTimes.push(durationMs);
    if (isError) this.errors.push(now);
    // Keep only last 2 minutes of data
    const cutoff = now - 120_000;
    this.requests = this.requests.filter(t => t > cutoff);
    this.errors = this.errors.filter(t => t > cutoff);
    if (this.responseTimes.length > 1000) {
      this.responseTimes = this.responseTimes.slice(-500);
    }
  }

  getMetrics(): HealthMetrics {
    const now = Date.now();
    const minuteAgo = now - 60_000;
    const recentRequests = this.requests.filter(t => t > minuteAgo).length;
    const recentErrors = this.errors.filter(t => t > minuteAgo).length;
    const recent = this.responseTimes.slice(-100);
    const avg = recent.length > 0 ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
    return {
      requestsLastMinute: recentRequests,
      errorsLastMinute: recentErrors,
      avgResponseTimeMs: Math.round(avg * 100) / 100,
    };
  }
}

export async function checkPostgres(prisma: any): Promise<HealthDependency> {
  const start = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { status: 'ok', latencyMs: Date.now() - start };
  } catch (err: any) {
    return { status: 'error', latencyMs: Date.now() - start, error: err.message };
  }
}

export async function checkRabbitMQ(connection: any): Promise<HealthDependency> {
  try {
    const connected = connection && (typeof connection.isConnected === 'function' ? connection.isConnected() : !!connection);
    return connected ? { status: 'ok' } : { status: 'error', error: 'Not connected' };
  } catch (err: any) {
    return { status: 'error', error: err.message };
  }
}

export function buildHealthResponse(
  service: string,
  dependencies: Record<string, HealthDependency>,
  metrics: HealthMetrics,
): HealthResponse {
  const allOk = Object.values(dependencies).every(d => d.status === 'ok');
  return {
    status: allOk ? 'ok' : 'degraded',
    service,
    uptime: process.uptime(),
    dependencies,
    metrics,
  };
}
