/**
 * Run a job again when the database connection dropped for a moment (Wi-Fi / ISP hiccups between
 * this server and MongoDB Atlas). Customer messages are saved once (message id), so a retry never doubles them.
 */
const TRANSIENT = /MongoNetwork|MongoServerSelection|MongoPoolCleared|MongoNotConnected|timed out|ECONNRESET|ETIMEDOUT|EPIPE|socket/i;
export const isTransientDbError = (err) => TRANSIENT.test(`${err?.name || ''} ${err?.message || ''}`) || err?.errorLabelSet?.has?.('RetryableError');

export async function withDbRetry(job, { tries = 3, waitMs = 1500, label = 'job' } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await job();
    } catch (err) {
      if (attempt >= tries || !isTransientDbError(err)) throw err;
      console.warn(`[db] ${label}: connection problem (${err.message}), trying again (${attempt}/${tries - 1})`);
      await new Promise((r) => setTimeout(r, waitMs * attempt));
    }
  }
}
