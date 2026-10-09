// Runs every end-to-end test (see lib.mjs for how to start the test API)
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';

const dir = new URL('.', import.meta.url).pathname;
let failed = 0;
for (const f of readdirSync(dir).filter((x) => x.endsWith('.mjs') && !['lib.mjs', 'run.mjs'].includes(x)).sort()) {
  const r = spawnSync(process.execPath, [dir + f], { encoding: 'utf8', cwd: dir + '..' });
  const out = (r.stdout || '') + (r.stderr || '');
  const summary = out.match(/(\d+) passed, (\d+) failed/);
  console.log(`${r.status === 0 ? '✅' : '❌'} ${f.padEnd(16)} ${summary ? summary[0] : 'crashed'}`);
  if (r.status !== 0) {
    failed++;
    console.log(out.split('\n').filter((l) => /^❌|CRASH/.test(l)).join('\n'));
  }
}
process.exit(failed ? 1 : 0);
