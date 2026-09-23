import crypto from 'node:crypto';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, id, now } from './db.js';
import {
  canApprove,
  nonTerminalStatuses,
  permitTypes,
  PermitType,
  requiredApprovalRole,
  Role,
  Status,
  transition,
  validateTypeDetails,
} from './domain.js';

const app = express();
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public');
app.use(express.json({ limit: '1mb' }));
app.use(express.static(publicDir));

type User = { id: string; name: string; email: string; role: Role; area_id?: string | null };
type Permit = {
  id: string;
  permit_no: string;
  type: PermitType;
  status: Status;
  requester_id: string;
  area_id: string;
  equipment_id?: string | null;
  planned_start: string;
  planned_end: string;
  details: string;
};

export function hashPassword(password: string, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), test);
}

function cookie(req: express.Request, key: string) {
  return req.headers.cookie
    ?.split(';')
    .map((part) => part.trim().split('='))
    .find(([name]) => name === key)?.[1];
}

function currentUser(req: express.Request) {
  const auth = req.header('authorization')?.replace(/^Bearer\s+/i, '');
  const token = auth || cookie(req, 'ptw_session');
  if (!token) throw new Error('Unauthenticated');
  const row = db
    .prepare(
      `SELECT u.id,u.name,u.email,u.role,u.area_id
       FROM sessions s JOIN users u ON u.id=s.user_id
       WHERE s.token=? AND s.expires_at>? AND u.active=1`,
    )
    .get(token, now()) as User | undefined;
  if (!row) throw new Error('Unauthenticated');
  return row;
}

function safeUser(user: User) {
  return { id: user.id, name: user.name, email: user.email, role: user.role, area_id: user.area_id };
}

function audit(permitId: string, actorId: string | null, action: string, field?: string | null, from?: unknown, to?: unknown, comment?: string) {
  db.prepare('INSERT INTO audit_logs VALUES (?,?,?,?,?,?,?,?,?)').run(
    id(),
    permitId,
    actorId,
    action,
    field || null,
    from == null ? null : String(from),
    to == null ? null : String(to),
    comment || null,
    now(),
  );
}

function rowPermit(idValue: string) {
  return db.prepare('SELECT * FROM permits WHERE id=?').get(idValue) as Permit | undefined;
}

function allApproved(permitId: string) {
  const row = db.prepare("SELECT count(*) c FROM approvals WHERE permit_id=? AND decision!='APPROVED'").get(permitId) as { c: number };
  return row.c === 0;
}

function expirePermits() {
  const permits = db
    .prepare(`SELECT * FROM permits WHERE status IN (${nonTerminalStatuses().map(() => '?').join(',')}) AND planned_end < ?`)
    .all(...nonTerminalStatuses(), now()) as Permit[];
  const tx = db.transaction((rows: Permit[]) => {
    for (const permit of rows) {
      db.prepare("UPDATE permits SET status='EXPIRED', updated_at=? WHERE id=?").run(now(), permit.id);
      audit(permit.id, null, 'AUTO_EXPIRED', 'status', permit.status, 'EXPIRED', 'Validity window passed');
    }
  });
  tx(permits);
}

setInterval(expirePermits, 60_000).unref();

function assertRole(user: User, roles: Role[]) {
  if (!roles.includes(user.role)) throw new Error('Not allowed for this role');
}

function parseDetails(body: any) {
  return typeof body.details === 'object' && body.details ? body.details : {};
}

function canClose(user: User, permit: Permit) {
  return user.role === 'ADMIN' || (user.role === 'REQUESTER' && permit.requester_id === user.id);
}

function allowedActions(user: User, permit: Permit) {
  const actions: string[] = [];
  const approvalRole = requiredApprovalRole(user.role);
  const pending = approvalRole
    ? db
        .prepare("SELECT id FROM approvals WHERE permit_id=? AND role=? AND decision='PENDING'")
        .get(permit.id, approvalRole)
    : null;
  if (permit.status === 'DRAFT' && (user.role === 'ADMIN' || permit.requester_id === user.id)) actions.push('submit');
  if (permit.status === 'PENDING_APPROVAL' && pending && canApprove(user.role, permit.requester_id, user.id, permit.area_id, user.area_id)) {
    actions.push('approve', 'reject');
  }
  if (permit.status === 'APPROVED' && (user.role === 'ADMIN' || user.role === 'REQUESTER')) actions.push('activate');
  if (permit.status === 'ACTIVE' && (user.role === 'ADMIN' || user.role === 'SAFETY_OFFICER')) actions.push('suspend');
  if (permit.status === 'SUSPENDED' && (user.role === 'ADMIN' || user.role === 'SAFETY_OFFICER')) actions.push('resume');
  if (permit.status === 'ACTIVE' && canClose(user, permit)) actions.push('close');
  if (permit.status === 'CLOSED' && (user.role === 'ADMIN' || user.role === 'SAFETY_OFFICER')) actions.push('verify');
  if (['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'CLOSED'].includes(permit.status) && (user.role === 'ADMIN' || permit.requester_id === user.id)) {
    actions.push('cancel');
  }
  if (permit.status === 'ACTIVE' && permit.requester_id === user.id) actions.push('request_extension');
  if (permit.status === 'ACTIVE') actions.push('log_work');
  return actions;
}

app.post('/api/auth/login', (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(req.body.email) as (User & { password_hash: string }) | undefined;
    if (!row || !verifyPassword(req.body.password || '', row.password_hash)) throw new Error('Invalid email or password');
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 7).toISOString();
    db.prepare('INSERT INTO sessions VALUES (?,?,?,?)').run(token, row.id, now(), expiresAt);
    res.setHeader('Set-Cookie', `ptw_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800`);
    res.json({ token, user: safeUser(row) });
  } catch (error: any) {
    res.status(401).json({ error: error.message });
  }
});

app.post('/api/auth/logout', (req, res) => {
  const token = cookie(req, 'ptw_session') || req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (token) db.prepare('DELETE FROM sessions WHERE token=?').run(token);
  res.setHeader('Set-Cookie', 'ptw_session=; Path=/; Max-Age=0');
  res.sendStatus(204);
});

app.get('/api/me', (req, res) => {
  try {
    res.json(safeUser(currentUser(req)));
  } catch {
    res.status(401).json({ error: 'Unauthenticated' });
  }
});

app.get('/api/meta', (req, res) => {
  try {
    currentUser(req);
    res.json({
      permitTypes,
      plants: db.prepare('SELECT * FROM plants ORDER BY name').all(),
      areas: db.prepare('SELECT * FROM areas ORDER BY name').all(),
      equipment: db.prepare('SELECT * FROM equipment ORDER BY tag').all(),
    });
  } catch (error: any) {
    res.status(401).json({ error: error.message });
  }
});

app.get('/api/users', (req, res) => {
  try {
    assertRole(currentUser(req), ['ADMIN']);
    res.json(db.prepare('SELECT id,name,email,role,area_id,active FROM users ORDER BY name').all());
  } catch (error: any) {
    res.status(403).json({ error: error.message });
  }
});

app.get('/api/permits', (req, res) => {
  try {
    expirePermits();
    const user = currentUser(req);
    const q = req.query;
    let sql = `SELECT p.*,u.name requester_name,pl.name plant_name,a.name area_name,e.tag equipment_tag,e.name equipment_name
      FROM permits p
      JOIN users u ON u.id=p.requester_id
      JOIN plants pl ON pl.id=p.plant_id
      JOIN areas a ON a.id=p.area_id
      LEFT JOIN equipment e ON e.id=p.equipment_id
      WHERE 1=1`;
    const args: any[] = [];
    for (const [key, col] of [
      ['status', 'p.status'],
      ['type', 'p.type'],
      ['area', 'p.area_id'],
    ] as const) {
      if (q[key]) {
        sql += ` AND ${col}=?`;
        args.push(q[key]);
      }
    }
    if (q.from) {
      sql += ' AND p.planned_end>=?';
      args.push(q.from);
    }
    if (q.to) {
      sql += ' AND p.planned_start<=?';
      args.push(q.to);
    }
    if (q.myApprovals === 'true') {
      const approvalRole = requiredApprovalRole(user.role);
      if (!approvalRole) return res.json([]);
      sql += " AND EXISTS (SELECT 1 FROM approvals ap WHERE ap.permit_id=p.id AND ap.role=? AND ap.decision='PENDING')";
      args.push(approvalRole);
      if (user.role === 'AREA_OWNER') {
        sql += ' AND p.area_id=?';
        args.push(user.area_id);
      }
      sql += ' AND p.requester_id<>?';
      args.push(user.id);
    }
    res.json(db.prepare(`${sql} ORDER BY p.planned_end ASC`).all(...args));
  } catch (error: any) {
    res.status(401).json({ error: error.message });
  }
});

app.get('/api/permits/:permitId', (req, res) => {
  try {
    expirePermits();
    const user = currentUser(req);
    const permit = db
      .prepare(
        `SELECT p.*,u.name requester_name,pl.name plant_name,a.name area_name,e.tag equipment_tag,e.name equipment_name
         FROM permits p
         JOIN users u ON u.id=p.requester_id
         JOIN plants pl ON pl.id=p.plant_id
         JOIN areas a ON a.id=p.area_id
         LEFT JOIN equipment e ON e.id=p.equipment_id
         WHERE p.id=?`,
      )
      .get(req.params.permitId) as any;
    if (!permit) return res.sendStatus(404);
    res.json({
      ...permit,
      details: JSON.parse(permit.details),
      allowedActions: allowedActions(user, permit),
      approvals: db.prepare('SELECT a.*,u.name approver_name FROM approvals a LEFT JOIN users u ON u.id=a.approver_id WHERE permit_id=? ORDER BY role').all(permit.id),
      audit: db
        .prepare('SELECT l.*,COALESCE(u.name, "System timer") actor_name FROM audit_logs l LEFT JOIN users u ON u.id=l.actor_id WHERE permit_id=? ORDER BY created_at DESC')
        .all(permit.id),
      workLogs: db.prepare('SELECT w.*,u.name actor_name FROM work_logs w JOIN users u ON u.id=w.actor_id WHERE permit_id=? ORDER BY created_at DESC').all(permit.id),
      extensions: db
        .prepare('SELECT er.*,u.name requester_name,au.name approver_name FROM extension_requests er JOIN users u ON u.id=er.requester_id LEFT JOIN users au ON au.id=er.approver_id WHERE permit_id=? ORDER BY created_at DESC')
        .all(permit.id),
    });
  } catch (error: any) {
    res.status(401).json({ error: error.message });
  }
});

app.post('/api/permits', (req, res) => {
  try {
    const user = currentUser(req);
    assertRole(user, ['REQUESTER', 'ADMIN']);
    const body = req.body;
    const details = parseDetails(body);
    validateTypeDetails(body.type, details);
    if (new Date(body.plannedEnd) <= new Date(body.plannedStart)) throw new Error('Planned end must be after planned start');
    const permitId = id();
    const stamp = now();
    db.prepare(
      `INSERT INTO permits VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      permitId,
      `PTW-${new Date().getFullYear()}-${Math.floor(Math.random() * 900000 + 100000)}`,
      body.type,
      'DRAFT',
      user.id,
      body.contractor,
      body.description,
      body.plantId,
      body.areaId,
      body.equipmentId || null,
      body.plannedStart,
      body.plannedEnd,
      body.hazards,
      body.ppe,
      body.precautions,
      JSON.stringify(details),
      null,
      null,
      stamp,
      stamp,
    );
    for (const role of ['AREA_OWNER', 'SAFETY_OFFICER']) {
      db.prepare('INSERT INTO approvals VALUES (?,?,?,?,?,?,?,?)').run(id(), permitId, role, null, 'PENDING', null, null, null);
    }
    audit(permitId, user.id, 'CREATED', 'status', null, 'DRAFT');
    res.status(201).json({ id: permitId });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.patch('/api/permits/:permitId', (req, res) => {
  try {
    const user = currentUser(req);
    const permit = rowPermit(req.params.permitId);
    if (!permit) throw new Error('Permit not found');
    if (!(user.role === 'ADMIN' || permit.requester_id === user.id)) throw new Error('Only requester or admin may edit');
    if (['ACTIVE', 'SUSPENDED', 'CLOSED', 'CLOSED_VERIFIED', 'EXPIRED', 'REJECTED', 'CANCELLED'].includes(permit.status)) {
      throw new Error('This permit can no longer be edited');
    }
    const body = req.body;
    const nextDetails = body.details ? parseDetails(body) : JSON.parse(permit.details);
    validateTypeDetails((body.type || permit.type) as PermitType, nextDetails);
    const editable = ['contractor', 'description', 'planned_start', 'planned_end', 'hazards', 'ppe', 'precautions', 'details'] as const;
    const updates: string[] = [];
    const values: any[] = [];
    for (const field of editable) {
      const inputKey = field === 'planned_start' ? 'plannedStart' : field === 'planned_end' ? 'plannedEnd' : field;
      if (body[inputKey] !== undefined) {
        const toValue = field === 'details' ? JSON.stringify(nextDetails) : body[inputKey];
        updates.push(`${field}=?`);
        values.push(toValue);
        audit(permit.id, user.id, 'FIELD_EDITED', field, (permit as any)[field], toValue, body.comment || 'Permit edited');
      }
    }
    if (!updates.length) return res.json({ ok: true });
    updates.push('updated_at=?');
    values.push(now(), permit.id);
    db.prepare(`UPDATE permits SET ${updates.join(',')} WHERE id=?`).run(...values);
    res.json({ ok: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/permits/:permitId/action', (req, res) => {
  try {
    expirePermits();
    const user = currentUser(req);
    const permit = rowPermit(req.params.permitId);
    if (!permit) throw new Error('Permit not found');
    const { action, comment, signature, completionNotes, verificationNotes } = req.body;
    if (!allowedActions(user, permit).includes(action)) throw new Error('This action is not available to you');

    if (action === 'approve' || action === 'reject') {
      if (action === 'reject' && !comment) throw new Error('Rejection reason is required');
      const role = requiredApprovalRole(user.role);
      const approval = db.prepare("SELECT * FROM approvals WHERE permit_id=? AND role=? AND decision='PENDING'").get(permit.id, role) as any;
      if (!approval || !canApprove(user.role, permit.requester_id, user.id, permit.area_id, user.area_id)) throw new Error('No pending approval for this user');
      db.prepare('UPDATE approvals SET approver_id=?,decision=?,comment=?,signature=?,decided_at=? WHERE id=?').run(
        user.id,
        action === 'approve' ? 'APPROVED' : 'REJECTED',
        comment || null,
        signature || null,
        now(),
        approval.id,
      );
      if (action === 'reject') {
        db.prepare("UPDATE permits SET status='REJECTED',updated_at=? WHERE id=?").run(now(), permit.id);
        audit(permit.id, user.id, 'REJECTED', 'status', permit.status, 'REJECTED', comment);
        return res.json({ status: 'REJECTED' });
      }
      audit(permit.id, user.id, 'APPROVED', role, 'PENDING', 'APPROVED', comment);
      if (allApproved(permit.id)) {
        db.prepare("UPDATE permits SET status='APPROVED',updated_at=? WHERE id=?").run(now(), permit.id);
        audit(permit.id, user.id, 'ALL_APPROVED', 'status', 'PENDING_APPROVAL', 'APPROVED');
        return res.json({ status: 'APPROVED' });
      }
      return res.json({ status: permit.status });
    }

    const next = transition(permit.status, action, {
      allApproved: allApproved(permit.id),
      now: new Date(),
      plannedStart: new Date(permit.planned_start),
    });
    db.prepare('UPDATE permits SET status=?,completion_notes=COALESCE(?,completion_notes),verification_notes=COALESCE(?,verification_notes),updated_at=? WHERE id=?').run(
      next,
      completionNotes || null,
      verificationNotes || null,
      now(),
      permit.id,
    );
    audit(permit.id, user.id, action.toUpperCase(), 'status', permit.status, next, comment || completionNotes || verificationNotes);
    res.json({ status: next });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/permits/:permitId/work-logs', (req, res) => {
  try {
    const user = currentUser(req);
    const permit = rowPermit(req.params.permitId);
    if (!permit || permit.status !== 'ACTIVE') throw new Error("Work can only be logged against an ACTIVE permit");
    db.prepare('INSERT INTO work_logs VALUES (?,?,?,?,?)').run(id(), permit.id, user.id, req.body.note, now());
    audit(permit.id, user.id, 'WORK_LOGGED', 'note', null, req.body.note);
    res.sendStatus(201);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/permits/:permitId/extensions', (req, res) => {
  try {
    const user = currentUser(req);
    const permit = rowPermit(req.params.permitId);
    if (!permit || permit.status !== 'ACTIVE' || permit.requester_id !== user.id) throw new Error('Only requester can request extension for an active permit');
    const hours = Number(req.body.hours);
    if (!Number.isInteger(hours) || hours < 1 || hours > 4) throw new Error('Extensions are capped between 1 and 4 hours');
    db.prepare('INSERT INTO extension_requests VALUES (?,?,?,?,?,?,?,?,?)').run(id(), permit.id, user.id, hours, req.body.reason, 'PENDING', null, null, now());
    audit(permit.id, user.id, 'EXTENSION_REQUESTED', 'planned_end', permit.planned_end, `+${hours} hour(s)`, req.body.reason);
    res.sendStatus(201);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.post('/api/extensions/:extensionId/decision', (req, res) => {
  try {
    const user = currentUser(req);
    assertRole(user, ['SAFETY_OFFICER', 'ADMIN']);
    const extension = db.prepare("SELECT * FROM extension_requests WHERE id=? AND status='PENDING'").get(req.params.extensionId) as any;
    if (!extension) throw new Error('No pending extension request');
    const permit = rowPermit(extension.permit_id);
    if (!permit) throw new Error('Permit not found');
    const approved = req.body.decision === 'APPROVED';
    if (approved) {
      const nextEnd = new Date(new Date(permit.planned_end).getTime() + extension.hours * 60 * 60 * 1000).toISOString();
      db.prepare('UPDATE permits SET planned_end=?,updated_at=? WHERE id=?').run(nextEnd, now(), permit.id);
      audit(permit.id, user.id, 'EXTENSION_APPROVED', 'planned_end', permit.planned_end, nextEnd, req.body.comment);
    } else {
      audit(permit.id, user.id, 'EXTENSION_REJECTED', 'extension', `+${extension.hours} hours`, 'Rejected', req.body.comment);
    }
    db.prepare('UPDATE extension_requests SET status=?,approver_id=?,decided_at=? WHERE id=?').run(approved ? 'APPROVED' : 'REJECTED', user.id, now(), extension.id);
    res.json({ ok: true });
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
});

app.get('*', (_req, res) => res.sendFile(path.join(publicDir, 'index.html')));

function listen(port: number, attemptsLeft = 10) {
  const server = app.listen(port, () => console.log(`PTW running at http://localhost:${port}`));
  server.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE' && !process.env.PORT && attemptsLeft > 0) {
      console.log(`Port ${port} is busy, trying ${port + 1}...`);
      listen(port + 1, attemptsLeft - 1);
      return;
    }
    console.error(error.message);
    process.exit(1);
  });
}

if (process.env.NODE_ENV !== 'test') {
  listen(Number(process.env.PORT || 3000));
}

export { app };
