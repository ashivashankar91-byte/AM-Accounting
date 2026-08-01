// CE-10 / S124 — bounded automatic retries with exponential backoff on
// transient engine failure, then transition to the exception queue. Every
// attempt (including retries) is logged by the caller via
// tax_engine_attempt_log — this module only implements the retry timing.

export interface RetryOptions {
  maxAttempts: number;
  initialDelayMs: number;
  backoffMultiplier: number;
}

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  initialDelayMs: 50,
  backoffMultiplier: 2,
};

export interface RetryAttemptResult<T> {
  result?: T;
  error?: unknown;
  attemptNumber: number;
  durationMs: number;
}

/**
 * Calls `fn` up to options.maxAttempts times. `isRetryable` decides whether
 * a thrown error should trigger another attempt (transient) or stop
 * immediately (durable rejection/misconfiguration — no point retrying).
 * `onAttempt` is invoked after every attempt (success or failure) so the
 * caller can append to tax_engine_attempt_log before deciding what to do
 * next — this helper never itself decides "give up -> exception queue";
 * that policy belongs to the caller (TaxCalculationService).
 */
export async function withRetryBackoff<T>(
  fn: () => Promise<T>,
  isRetryable: (err: unknown) => boolean,
  onAttempt: (attempt: RetryAttemptResult<T>) => void | Promise<void>,
  options: RetryOptions = DEFAULT_RETRY_OPTIONS,
): Promise<{ result: T } | { error: unknown }> {
  let delay = options.initialDelayMs;
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.maxAttempts; attempt += 1) {
    const start = Date.now();
    try {
      const result = await fn();
      await onAttempt({ result, attemptNumber: attempt, durationMs: Date.now() - start });
      return { result };
    } catch (err) {
      lastError = err;
      await onAttempt({ error: err, attemptNumber: attempt, durationMs: Date.now() - start });
      if (!isRetryable(err) || attempt === options.maxAttempts) {
        return { error: err };
      }
      await sleep(delay);
      delay *= options.backoffMultiplier;
    }
  }
  return { error: lastError };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
