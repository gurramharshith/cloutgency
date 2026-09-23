export const schema = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('REQUESTER','AREA_OWNER','SAFETY_OFFICER','ADMIN')),
  area_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS plants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS areas (
  id TEXT PRIMARY KEY,
  plant_id TEXT NOT NULL REFERENCES plants(id),
  name TEXT NOT NULL,
  UNIQUE (plant_id, name)
);

CREATE TABLE IF NOT EXISTS equipment (
  id TEXT PRIMARY KEY,
  area_id TEXT NOT NULL REFERENCES areas(id),
  tag TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS permits (
  id TEXT PRIMARY KEY,
  permit_no TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('HOT_WORK','CONFINED_SPACE','WORKING_AT_HEIGHT','ELECTRICAL_LOTO')),
  status TEXT NOT NULL,
  requester_id TEXT NOT NULL REFERENCES users(id),
  contractor TEXT NOT NULL,
  description TEXT NOT NULL,
  plant_id TEXT NOT NULL REFERENCES plants(id),
  area_id TEXT NOT NULL REFERENCES areas(id),
  equipment_id TEXT REFERENCES equipment(id),
  planned_start TEXT NOT NULL,
  planned_end TEXT NOT NULL,
  hazards TEXT NOT NULL,
  ppe TEXT NOT NULL,
  precautions TEXT NOT NULL,
  details TEXT NOT NULL,
  completion_notes TEXT,
  verification_notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  permit_id TEXT NOT NULL REFERENCES permits(id),
  role TEXT NOT NULL CHECK (role IN ('AREA_OWNER','SAFETY_OFFICER')),
  approver_id TEXT REFERENCES users(id),
  decision TEXT NOT NULL DEFAULT 'PENDING',
  comment TEXT,
  signature TEXT,
  decided_at TEXT,
  UNIQUE (permit_id, role)
);

CREATE TABLE IF NOT EXISTS extension_requests (
  id TEXT PRIMARY KEY,
  permit_id TEXT NOT NULL REFERENCES permits(id),
  requester_id TEXT NOT NULL REFERENCES users(id),
  hours INTEGER NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  approver_id TEXT REFERENCES users(id),
  decided_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  permit_id TEXT NOT NULL REFERENCES permits(id),
  actor_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  field TEXT,
  from_value TEXT,
  to_value TEXT,
  comment TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS work_logs (
  id TEXT PRIMARY KEY,
  permit_id TEXT NOT NULL REFERENCES permits(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  note TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;
