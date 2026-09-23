-- Postgres-compatible production schema for the Permit to Work module.

CREATE TABLE plants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE areas (
  id TEXT PRIMARY KEY,
  plant_id TEXT NOT NULL REFERENCES plants(id),
  name TEXT NOT NULL,
  UNIQUE (plant_id, name)
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('REQUESTER','AREA_OWNER','SAFETY_OFFICER','ADMIN')),
  area_id TEXT REFERENCES areas(id),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE equipment (
  id TEXT PRIMARY KEY,
  area_id TEXT NOT NULL REFERENCES areas(id),
  tag TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL
);

CREATE TABLE permits (
  id TEXT PRIMARY KEY,
  permit_no TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('HOT_WORK','CONFINED_SPACE','WORKING_AT_HEIGHT','ELECTRICAL_LOTO')),
  status TEXT NOT NULL CHECK (status IN ('DRAFT','PENDING_APPROVAL','APPROVED','ACTIVE','SUSPENDED','EXPIRED','REJECTED','CLOSED','CLOSED_VERIFIED','CANCELLED')),
  requester_id TEXT NOT NULL REFERENCES users(id),
  contractor TEXT NOT NULL,
  description TEXT NOT NULL,
  plant_id TEXT NOT NULL REFERENCES plants(id),
  area_id TEXT NOT NULL REFERENCES areas(id),
  equipment_id TEXT REFERENCES equipment(id),
  planned_start TIMESTAMPTZ NOT NULL,
  planned_end TIMESTAMPTZ NOT NULL,
  hazards TEXT NOT NULL,
  ppe TEXT NOT NULL,
  precautions TEXT NOT NULL,
  details JSONB NOT NULL,
  completion_notes TEXT,
  verification_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE approvals (
  id TEXT PRIMARY KEY,
  permit_id TEXT NOT NULL REFERENCES permits(id),
  role TEXT NOT NULL CHECK (role IN ('AREA_OWNER','SAFETY_OFFICER')),
  approver_id TEXT REFERENCES users(id),
  decision TEXT NOT NULL DEFAULT 'PENDING' CHECK (decision IN ('PENDING','APPROVED','REJECTED')),
  comment TEXT,
  signature TEXT,
  decided_at TIMESTAMPTZ,
  UNIQUE (permit_id, role)
);

CREATE TABLE extension_requests (
  id TEXT PRIMARY KEY,
  permit_id TEXT NOT NULL REFERENCES permits(id),
  requester_id TEXT NOT NULL REFERENCES users(id),
  hours INTEGER NOT NULL CHECK (hours BETWEEN 1 AND 4),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  approver_id TEXT REFERENCES users(id),
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  permit_id TEXT NOT NULL REFERENCES permits(id),
  actor_id TEXT REFERENCES users(id),
  action TEXT NOT NULL,
  field TEXT,
  from_value TEXT,
  to_value TEXT,
  comment TEXT,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE work_logs (
  id TEXT PRIMARY KEY,
  permit_id TEXT NOT NULL REFERENCES permits(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  note TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX idx_permits_status ON permits(status);
CREATE INDEX idx_permits_type ON permits(type);
CREATE INDEX idx_permits_area_window ON permits(area_id, planned_start, planned_end);
CREATE INDEX idx_approvals_pending ON approvals(permit_id, role, decision);
CREATE INDEX idx_audit_permit_time ON audit_logs(permit_id, created_at DESC);
