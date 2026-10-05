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

export async function connectDB() {
  let uri = env.mongoUri;

  if (!uri) {
    if (env.isProd) throw new Error('MONGO_URI is required in production');
    uri = await startDevMongo();
  }

  await mongoose.connect(uri);
  console.log('[db] MongoDB connected');
}

export async function disconnectDB() {
  await mongoose.disconnect();
  if (memoryServer) await memoryServer.stop({ doCleanup: false });
}
