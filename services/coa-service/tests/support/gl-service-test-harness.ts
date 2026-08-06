// CE-07 (single authoritative ledger decision) — spawns a REAL gl-service
// process (the actual, unmodified compiled application, `dist/index.js`)
// for integration-testing GlPostingBridge against gl-service's real HTTP
// API, not a mock or re-implementation. This is more faithful to production
// than an in-process import (which also hits real cross-service Prisma
// module resolution issues, since each service's generated Prisma client
// lives only in that service's own node_modules).
import { spawn, ChildProcess } from 'child_process';
import path from 'path';

export interface GlServiceProcessHandle {
  baseUrl: string;
  close: () => Promise<void>;
  /** Full accumulated stdout+stderr since spawn — useful for diagnosing a runtime (post-startup) failure a test assertion surfaces, not just a startup failure. */
  getRecentLogs: () => string;
}

async function waitForHealth(baseUrl: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`gl-service did not become healthy within ${timeoutMs}ms at ${baseUrl}`);
}

export async function startGlServiceProcess(databaseUrl: string, jwtSecret: string, port: number, rabbitmqUrl = 'amqp://127.0.0.1:1'): Promise<GlServiceProcessHandle> {
  // rabbitmqUrl defaults to a deliberately unreachable address —
  // event-publisher.connect() falls back to in-memory gracefully, never
  // blocks startup — for the many tests that only assert against
  // gl-service's own HTTP/DB surface. Pass a REAL, reachable broker URL
  // (e.g. 'amqp://127.0.0.1:5672') for a test that needs schedule-service
  // (or any other real consumer) to actually receive JOURNAL_ENTRY_POSTED.
  const glServiceDir = path.resolve(__dirname, '../../../gl-service');
  const child: ChildProcess = spawn(process.execPath, ['dist/index.js'], {
    cwd: glServiceDir,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      AMACC_JWT_SECRET: jwtSecret,
      PORT: String(port),
      RABBITMQ_URL: rabbitmqUrl,
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let logBuf = '';
  child.stderr?.on('data', (d) => { logBuf += d.toString(); });
  child.stdout?.on('data', (d) => { logBuf += d.toString(); });

  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForHealth(baseUrl);
  } catch (e) {
    child.kill('SIGKILL');
    throw new Error(`${(e as Error).message}\ngl-service stderr:\n${logBuf.slice(-4000)}`);
  }

  return {
    baseUrl,
    getRecentLogs: () => logBuf.slice(-60000),
    close: async () => {
      child.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 300));
      if (!child.killed) child.kill('SIGKILL');
    },
  };
}

/**
 * CE-07 closing pass — spawns a REAL schedule-service process (the actual,
 * unmodified compiled application) for certifying the real
 * JOURNAL_ENTRY_POSTED consumer (OpenItemService.processPostingEvent) — not
 * a re-derivation of its logic. Requires a REAL, reachable RabbitMQ broker
 * (schedule-service's own consume() only wires up if its own connect()
 * succeeds — see infrastructure/event-publisher.ts) — pass the SAME
 * rabbitmqUrl used for the paired startGlServiceProcess() call, or this
 * process will never receive anything gl-service publishes.
 */
export async function startScheduleServiceProcess(databaseUrl: string, jwtSecret: string, port: number, rabbitmqUrl: string): Promise<GlServiceProcessHandle> {
  const scheduleServiceDir = path.resolve(__dirname, '../../../schedule-service');
  const child: ChildProcess = spawn(process.execPath, ['dist/index.js'], {
    cwd: scheduleServiceDir,
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      AMACC_JWT_SECRET: jwtSecret,
      PORT: String(port),
      RABBITMQ_URL: rabbitmqUrl,
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let logBuf = '';
  child.stderr?.on('data', (d) => { logBuf += d.toString(); });
  child.stdout?.on('data', (d) => { logBuf += d.toString(); });

  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForHealth(baseUrl);
  } catch (e) {
    child.kill('SIGKILL');
    throw new Error(`${(e as Error).message}\nschedule-service stderr:\n${logBuf.slice(-4000)}`);
  }

  return {
    baseUrl,
    getRecentLogs: () => logBuf.slice(-60000),
    close: async () => {
      child.kill('SIGTERM');
      await new Promise((r) => setTimeout(r, 300));
      if (!child.killed) child.kill('SIGKILL');
    },
  };
}
