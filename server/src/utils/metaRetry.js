/**
 * Calls to Meta's Graph API (Facebook / Instagram) fail now and then with "temporary" errors
 * (code 1 / 2, or is_transient: true): Meta did not do the action, so trying again is safe.
 * Reads (GET) are also tried again after a dropped connection. Writes are never repeated when the
 * answer was lost on the way back, because Meta may already have done them (a reply would show twice).
 */
const TRANSIENT_CODES = new Set([1, 2]);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export function isTransient(err, method) {
  const meta = err.response?.data?.error;
  if (meta) return meta.is_transient === true || TRANSIENT_CODES.has(meta.code);
  if (err.response) return err.response.status >= 500 && method === 'get';
  return method === 'get'; // no answer at all (network): only reads are repeated
}

/** Runs fn (an axios call) up to 3 times for temporary Meta errors; logs every failure with Meta's own reason */
export async function withMetaRetry(fn, { method = 'get', label = 'meta', path = '' } = {}) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      const meta = err.response?.data?.error;
      const retry = attempt < 3 && isTransient(err, method);
      console.warn(
        `[${label}] ${method.toUpperCase()} ${String(path).replace(/access_token=[^&]+/, 'access_token=***')} failed (try ${attempt}${retry ? ', retrying' : ''}):`,
        meta ? `code=${meta.code} subcode=${meta.error_subcode ?? '-'} type=${meta.type} msg=${meta.message} trace=${meta.fbtrace_id ?? '-'}` : `${err.code || ''} ${err.message}`
      );
      if (!retry) throw err;
      await wait(attempt * 700);
    }
  }
}
