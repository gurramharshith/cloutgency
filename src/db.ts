import Database from 'better-sqlite3';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { schema } from './schema.js';

// Vercel functions may only write to /tmp. Local development retains ptw.db.
const databasePath = process.env.DB_PATH || (process.env.VERCEL ? path.join(tmpdir(), 'ptw.db') : 'ptw.db');
export const db = new Database(databasePath);
db.pragma('foreign_keys = ON');
db.exec(schema);
export const id=()=>crypto.randomUUID(); export const now=()=>new Date().toISOString();
