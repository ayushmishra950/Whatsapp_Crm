import fs from 'node:fs';
import path from 'node:path';
import mongoose from 'mongoose';
import { env } from './env.js';

let memoryServer;

const DEV_PORT = 27018;
const DEV_URI = `mongodb://127.0.0.1:${DEV_PORT}/whatsapp_crm`;

// Dev fallback: a real mongod binary with data persisted in server/.mongo-data.
// If one is still running from a previous (nodemon) run, reuse it.
async function startDevMongo() {
  const probe = mongoose.createConnection(DEV_URI, { serverSelectionTimeoutMS: 1000 });
  try {
    await probe.asPromise();
    await probe.close();
    console.log(`[db] Reusing local dev MongoDB at ${DEV_URI}`);
    return DEV_URI;
  } catch {
    await probe.close().catch(() => {});
  }

  const { MongoMemoryServer } = await import('mongodb-memory-server');
  const dbPath = path.resolve('.mongo-data');
  fs.mkdirSync(dbPath, { recursive: true });
  memoryServer = await MongoMemoryServer.create({
    instance: { dbPath, storageEngine: 'wiredTiger', port: DEV_PORT },
  });
  console.log(`[db] No MONGO_URI set, started local dev MongoDB at ${DEV_URI}`);
  return DEV_URI;
}

// ---------- retry reads on a dropped connection ----------
// The driver retries a read once; on a flaky network the retry can land on another dead pooled connection.
// Reads (never writes) get two more tries on a fresh connection, so a page shows its data instead of an error.
const READ_OPS = new Set(['find', 'findOne', 'countDocuments', 'estimatedDocumentCount', 'distinct']);
const isNetworkError = (err) =>
  /MongoNetwork|MongoServerSelection|PoolCleared/i.test(err?.name || '') || /timed out|ECONNRESET|ETIMEDOUT|connection .* closed/i.test(err?.message || '');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let retryInstalled = false;
function installReadRetry() {
  if (retryInstalled) return;
  retryInstalled = true;
  const queryExec = mongoose.Query.prototype.exec;
  mongoose.Query.prototype.exec = async function exec(...args) {
    if (!READ_OPS.has(this.op)) return queryExec.apply(this, args);
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await queryExec.apply(attempt ? this.clone() : this, args);
      } catch (err) {
        if (attempt >= 2 || !isNetworkError(err)) throw err;
        await wait(250 * (attempt + 1));
      }
    }
  };
  const aggExec = mongoose.Aggregate.prototype.exec;
  mongoose.Aggregate.prototype.exec = async function exec(...args) {
    // $out / $merge write data: never repeat those
    if (this.pipeline().some((st) => st.$out || st.$merge)) return aggExec.apply(this, args);
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await aggExec.apply(this, args);
      } catch (err) {
        if (attempt >= 2 || !isNetworkError(err)) throw err;
        await wait(250 * (attempt + 1));
      }
    }
  };
}

export async function connectDB() {
  installReadRetry();
  let uri = env.mongoUri;

  if (!uri) {
    if (env.isProd) throw new Error('MONGO_URI is required in production');
    uri = await startDevMongo();
  }

  await mongoose.connect(uri, {
    // A network can silently drop the TCP connection to MongoDB (we saw resets every ~25 s on some
    // Wi-Fi / ISP routes). Without a timeout a query on a dead socket hangs ~19 s until the OS gives up,
    // and every page waits for it. With a socket timeout the query fails fast and the driver retries it
    // once on a fresh connection (retryable reads / writes), so the user waits a few seconds at most.
    socketTimeoutMS: env.dbSocketTimeoutMs,
    heartbeatFrequencyMS: 5000, // notice a dead server sooner
    // Routers / NAT often drop TCP connections that are idle for ~20 s without telling either side;
    // never reuse a pooled connection that has been idle longer than this (open a fresh one instead).
    maxIdleTimeMS: env.dbMaxIdleMs,
    serverSelectionTimeoutMS: 15000,
  });
  console.log('[db] MongoDB connected');
}

export async function disconnectDB() {
  await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop({ doCleanup: false });
}
