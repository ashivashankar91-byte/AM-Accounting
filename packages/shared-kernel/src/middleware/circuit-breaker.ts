export interface CircuitBreakerOptions {
  failureThreshold: number;
  resetTimeMs: number;
  halfOpenMaxCalls: number;
}

type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private failures: number[] = [];
  private lastOpenedAt = 0;
  private halfOpenCalls = 0;
  private readonly options: CircuitBreakerOptions;

  constructor(options?: Partial<CircuitBreakerOptions>) {
    this.options = {
      failureThreshold: options?.failureThreshold ?? 3,
      resetTimeMs: options?.resetTimeMs ?? 30_000,
      halfOpenMaxCalls: options?.halfOpenMaxCalls ?? 1,
    };
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastOpenedAt >= this.options.resetTimeMs) {
        this.state = 'HALF_OPEN';
        this.halfOpenCalls = 0;
      } else {
        throw new CircuitOpenError('Circuit breaker is OPEN — service unavailable');
      }
    }

    if (this.state === 'HALF_OPEN' && this.halfOpenCalls >= this.options.halfOpenMaxCalls) {
      throw new CircuitOpenError('Circuit breaker is HALF_OPEN — max probe calls reached');
    }

    try {
      if (this.state === 'HALF_OPEN') this.halfOpenCalls++;
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess() {
    this.failures = [];
    this.state = 'CLOSED';
    this.halfOpenCalls = 0;
  }

  private onFailure() {
    const now = Date.now();
    this.failures.push(now);
    // Keep only failures within 60 seconds
    this.failures = this.failures.filter(t => now - t < 60_000);
    if (this.failures.length >= this.options.failureThreshold) {
      this.state = 'OPEN';
      this.lastOpenedAt = now;
    }
  }

  getState(): CircuitState {
    return this.state;
  }
}

export class CircuitOpenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitOpenError';
  }
}
