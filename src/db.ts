import Database from 'better-sqlite3'; import {schema} from './schema.js';
export const db=new Database(process.env.DB_PATH||'ptw.db'); db.pragma('foreign_keys = ON'); db.exec(schema);
export const id=()=>crypto.randomUUID(); export const now=()=>new Date().toISOString();
