import crypto from 'node:crypto';
import { db, id, now } from './db.js';
import { schema } from './schema.js';

function hashPassword(password: string, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

db.exec(`
DROP TABLE IF EXISTS sessions;
DROP TABLE IF EXISTS work_logs;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS extension_requests;
DROP TABLE IF EXISTS approvals;
DROP TABLE IF EXISTS permits;
DROP TABLE IF EXISTS equipment;
DROP TABLE IF EXISTS areas;
DROP TABLE IF EXISTS plants;
DROP TABLE IF EXISTS users;
`);
db.exec(schema);
db.exec(`
DELETE FROM sessions;
DELETE FROM work_logs;
DELETE FROM audit_logs;
DELETE FROM extension_requests;
DELETE FROM approvals;
DELETE FROM permits;
DELETE FROM equipment;
DELETE FROM areas;
DELETE FROM plants;
DELETE FROM users;
`);

const stamp = now();
const plants = [
  ['plant-north', 'North Plant'],
  ['plant-south', 'South Plant'],
];
const areas = [
  ['area-process', 'plant-north', 'Process'],
  ['area-utilities', 'plant-north', 'Utilities'],
  ['area-packaging', 'plant-south', 'Packaging'],
];
const equipment = [
  ['eq-p204', 'area-utilities', 'P-204', 'Condensate Pump'],
  ['eq-v101', 'area-process', 'V-101', 'Solvent Storage Vessel'],
  ['eq-r302', 'area-process', 'R-302', 'Reactor Agitator'],
  ['eq-mcc7', 'area-utilities', 'MCC-7', 'Motor Control Centre'],
  ['eq-cv11', 'area-packaging', 'CV-11', 'Packing Conveyor'],
  ['eq-t901', 'area-packaging', 'T-901', 'Finished Goods Tank'],
];
const users = [
  ['req', 'Ravi Kumar', 'ravi@demo.com', 'ravi123', 'REQUESTER', null],
  ['area', 'Priya Shah', 'priya@demo.com', 'priya123', 'AREA_OWNER', 'area-utilities'],
  ['safe', 'Anita Rao', 'anita@demo.com', 'anita123', 'SAFETY_OFFICER', null],
  ['admin', 'Dev Mehta', 'admin@demo.com', 'dev123', 'ADMIN', null],
];

for (const plant of plants) db.prepare('INSERT INTO plants VALUES (?,?)').run(...plant);
for (const area of areas) db.prepare('INSERT INTO areas VALUES (?,?,?)').run(...area);
for (const item of equipment) db.prepare('INSERT INTO equipment VALUES (?,?,?,?)').run(...item);
for (const user of users) {
  db.prepare('INSERT INTO users VALUES (?,?,?,?,?,?,?,?)').run(user[0], user[1], user[2], hashPassword(String(user[3])), user[4], user[5], 1, stamp);
}

const typeDetails = {
  HOT_WORK: {
    hotWorkType: 'Welding',
    fireWatch: 'Suresh Patel',
    extinguisherType: '9kg DCP',
    combustiblesRadiusM: 10,
    lelPercent: 0,
    oxygenPercent: 20.9,
    gasTestTime: stamp,
  },
  CONFINED_SPACE: {
    spaceId: 'V-101',
    entryPoint: 'Top manway',
    oxygenPercent: 20.8,
    lelPercent: 0,
    h2sPpm: 0,
    coPpm: 3,
    gasTestTime: stamp,
    standbyAttendant: 'Mahesh Iyer',
    rescuePlan: 'Tripod, lifeline and BA set staged near entry point',
    ventilationMethod: 'Forced air blower',
    entryExitLog: 'Ramesh in 10:10, out 10:42; Karim in 10:45, out 11:05',
  },
  WORKING_AT_HEIGHT: {
    heightM: 6.5,
    accessMethod: 'Scaffold',
    fallArrestEquipment: 'Full body harness with double lanyard',
    anchorPointChecked: true,
    barricadingBelow: true,
  },
  ELECTRICAL_LOTO: {
    equipmentTag: 'MCC-7',
    voltageLevel: '415V',
    isolationPoints: 'MCC-7 incomer; local isolator at pump skid',
    lockNumbers: 'L-120, L-121',
    tagNumbers: 'T-881, T-882',
    earthingApplied: true,
    testedDeadBy: 'Anita Rao',
  },
};

const rows = [
  ['HOT_WORK', 'ACTIVE', 'area-utilities', 'eq-p204', -60, 75, 'Weld support bracket on steam line'],
  ['CONFINED_SPACE', 'PENDING_APPROVAL', 'area-process', 'eq-v101', 60, 240, 'Internal inspection of solvent vessel'],
  ['WORKING_AT_HEIGHT', 'APPROVED', 'area-packaging', 'eq-cv11', 30, 180, 'Replace overhead cable tray cover'],
  ['ELECTRICAL_LOTO', 'DRAFT', 'area-utilities', 'eq-mcc7', 180, 420, 'Isolate MCC feeder for pump maintenance'],
  ['HOT_WORK', 'SUSPENDED', 'area-process', 'eq-r302', -120, 120, 'Cut seized agitator guard bolts'],
  ['CONFINED_SPACE', 'CLOSED', 'area-packaging', 'eq-t901', -300, -60, 'Clean finished goods tank'],
  ['WORKING_AT_HEIGHT', 'CLOSED_VERIFIED', 'area-utilities', 'eq-p204', -420, -300, 'Inspect cooling tower platform'],
  ['ELECTRICAL_LOTO', 'EXPIRED', 'area-process', 'eq-r302', -480, -360, 'Panel megger testing'],
  ['HOT_WORK', 'REJECTED', 'area-packaging', 'eq-cv11', 90, 240, 'Grind conveyor frame bracket'],
  ['CONFINED_SPACE', 'CANCELLED', 'area-process', 'eq-v101', 240, 420, 'Planned sump entry cancelled after process upset'],
] as const;

for (let i = 0; i < rows.length; i++) {
  const [type, status, areaId, equipmentId, startOffset, endOffset, description] = rows[i];
  const permitId = id();
  const plannedStart = new Date(Date.now() + startOffset * 60_000).toISOString();
  const plannedEnd = new Date(Date.now() + endOffset * 60_000).toISOString();
  db.prepare('INSERT INTO permits VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(
    permitId,
    `PTW-2026-${String(i + 1).padStart(3, '0')}`,
    type,
    status,
    'req',
    i % 2 ? 'Delta Maintenance' : 'Apex Engineering',
    description,
    areaId === 'area-packaging' ? 'plant-south' : 'plant-north',
    areaId,
    equipmentId,
    plannedStart,
    plannedEnd,
    'Flammable vapour; stored energy; line of fire',
    'Helmet, goggles, gloves, safety shoes, face shield as applicable',
    'Toolbox talk completed; barricade set; gas testing repeated at shift handover',
    JSON.stringify(typeDetails[type]),
    status === 'CLOSED' || status === 'CLOSED_VERIFIED' ? 'Work completed and handed back' : null,
    status === 'CLOSED_VERIFIED' ? 'Area checked clean, locks/tags removed where applicable' : null,
    stamp,
    stamp,
  );
  const approvalDecision = ['DRAFT', 'PENDING_APPROVAL', 'REJECTED', 'CANCELLED'].includes(status) ? 'PENDING' : 'APPROVED';
  db.prepare('INSERT INTO approvals VALUES (?,?,?,?,?,?,?,?)').run(id(), permitId, 'AREA_OWNER', approvalDecision === 'APPROVED' ? 'area' : null, approvalDecision, approvalDecision === 'APPROVED' ? 'Area is prepared' : null, null, approvalDecision === 'APPROVED' ? stamp : null);
  db.prepare('INSERT INTO approvals VALUES (?,?,?,?,?,?,?,?)').run(id(), permitId, 'SAFETY_OFFICER', approvalDecision === 'APPROVED' ? 'safe' : null, approvalDecision, approvalDecision === 'APPROVED' ? 'Precautions verified' : null, null, approvalDecision === 'APPROVED' ? stamp : null);
  db.prepare('INSERT INTO audit_logs VALUES (?,?,?,?,?,?,?,?,?)').run(id(), permitId, 'req', 'CREATED', 'status', null, 'DRAFT', null, stamp);
  if (status !== 'DRAFT') db.prepare('INSERT INTO audit_logs VALUES (?,?,?,?,?,?,?,?,?)').run(id(), permitId, 'req', 'SEEDED_STATUS', 'status', 'DRAFT', status, 'Demo seed data', stamp);
}

console.log('Seeded demo data.');
console.log('Logins: ravi@demo.com/ravi123, priya@demo.com/priya123, anita@demo.com/anita123, admin@demo.com/dev123');
