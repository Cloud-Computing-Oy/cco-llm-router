/** Runtime guard for intermittent Ollama workers (for example a laptop GPU). */

const intEnv = (name: string, fallback: number, min: number): number => {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) ? Math.max(min, parsed) : fallback;
};

const HEALTH_TIMEOUT_MS = () => intEnv('CCO_LLM_OLLAMA_HEALTH_TIMEOUT_MS', 1_500, 100);
const REQUEST_TIMEOUT_MS = () => intEnv('CCO_LLM_OLLAMA_REQUEST_TIMEOUT_MS', 120_000, 1_000);
const CIRCUIT_OPEN_MS = () => intEnv('CCO_LLM_OLLAMA_CIRCUIT_OPEN_MS', 60_000, 1_000);
const HEALTH_CACHE_MS = () => intEnv('CCO_LLM_OLLAMA_HEALTH_CACHE_MS', 5_000, 0);
const MAX_CONCURRENT = () => intEnv('CCO_LLM_OLLAMA_MAX_CONCURRENT', 1, 1);

let active = 0;
let circuitOpenUntil = 0;
let lastHealthAt = 0;
let lastHealthOk = false;

export type OllamaLease = {
  run<T>(operation: () => PromiseLike<T>): Promise<T>;
  release(): void;
};

function timeoutError(ms: number): Error {
  const error = new Error(`Ollama request exceeded ${ms}ms`);
  error.name = 'TimeoutError';
  return error;
}

async function isHealthy(): Promise<boolean> {
  const now = Date.now();
  if (now - lastHealthAt <= HEALTH_CACHE_MS()) return lastHealthOk;

  const base = (process.env.OLLAMA_BASE_URL ?? '').replace(/\/$/, '');
  if (!base) return false;

  try {
    const response = await fetch(`${base}/api/tags`, {
      method: 'GET',
      signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS()),
    });
    lastHealthOk = response.ok;
  } catch {
    lastHealthOk = false;
  }
  lastHealthAt = Date.now();
  return lastHealthOk;
}

export async function acquireOllamaLease(): Promise<OllamaLease> {
  const now = Date.now();
  if (now < circuitOpenUntil) {
    throw new Error(`Ollama circuit open for ${circuitOpenUntil - now}ms`);
  }
  if (active >= MAX_CONCURRENT()) throw new Error('Ollama worker busy');
  if (!(await isHealthy())) {
    circuitOpenUntil = Date.now() + CIRCUIT_OPEN_MS();
    throw new Error('Ollama health check failed');
  }

  // Another request may have acquired the worker while this request awaited
  // the health probe. Re-check before reserving the slot.
  if (active >= MAX_CONCURRENT()) throw new Error('Ollama worker busy');
  active += 1;
  let released = false;
  return {
    async run<T>(operation: () => PromiseLike<T>): Promise<T> {
      const timeoutMs = REQUEST_TIMEOUT_MS();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const result = await Promise.race([
          operation(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(timeoutError(timeoutMs)), timeoutMs);
          }),
        ]);
        circuitOpenUntil = 0;
        return result;
      } catch (error) {
        circuitOpenUntil = Date.now() + CIRCUIT_OPEN_MS();
        throw error;
      } finally {
        if (timer) clearTimeout(timer);
      }
    },
    release() {
      if (released) return;
      released = true;
      active = Math.max(0, active - 1);
    },
  };
}

/** Test-only reset; intentionally not exported from the package entrypoint. */
export function resetOllamaGateForTests(): void {
  active = 0;
  circuitOpenUntil = 0;
  lastHealthAt = 0;
  lastHealthOk = false;
}
