export type PermitType = 'HOT_WORK' | 'CONFINED_SPACE' | 'WORKING_AT_HEIGHT' | 'ELECTRICAL_LOTO';
export type Status =
  | 'DRAFT'
  | 'PENDING_APPROVAL'
  | 'APPROVED'
  | 'ACTIVE'
  | 'SUSPENDED'
  | 'EXPIRED'
  | 'REJECTED'
  | 'CLOSED'
  | 'CLOSED_VERIFIED'
  | 'CANCELLED';
export type Role = 'REQUESTER' | 'AREA_OWNER' | 'SAFETY_OFFICER' | 'ADMIN';

export type TypeField = {
  key: string;
  label: string;
  type: 'text' | 'number' | 'select' | 'textarea' | 'datetime-local' | 'checkbox';
  required?: boolean;
  options?: string[];
};

export const permitTypes: Record<PermitType, { label: string; fields: TypeField[] }> = {
  HOT_WORK: {
    label: 'Hot Work',
    fields: [
      { key: 'hotWorkType', label: 'Hot work type', type: 'select', required: true, options: ['Welding', 'Grinding', 'Cutting', 'Soldering'] },
      { key: 'fireWatch', label: 'Fire watch assigned', type: 'text', required: true },
      { key: 'extinguisherType', label: 'Extinguisher type present', type: 'text', required: true },
      { key: 'combustiblesRadiusM', label: 'Combustibles cleared radius (m)', type: 'number', required: true },
      { key: 'lelPercent', label: 'LEL %', type: 'number', required: true },
      { key: 'oxygenPercent', label: 'O2 %', type: 'number', required: true },
      { key: 'gasTestTime', label: 'Gas test time', type: 'datetime-local', required: true },
    ],
  },
  CONFINED_SPACE: {
    label: 'Confined Space Entry',
    fields: [
      { key: 'spaceId', label: 'Space ID', type: 'text', required: true },
      { key: 'entryPoint', label: 'Entry point', type: 'text', required: true },
      { key: 'oxygenPercent', label: 'O2 %', type: 'number', required: true },
      { key: 'lelPercent', label: 'LEL %', type: 'number', required: true },
      { key: 'h2sPpm', label: 'H2S ppm', type: 'number', required: true },
      { key: 'coPpm', label: 'CO ppm', type: 'number', required: true },
      { key: 'gasTestTime', label: 'Atmospheric test time', type: 'datetime-local', required: true },
      { key: 'standbyAttendant', label: 'Standby attendant', type: 'text', required: true },
      { key: 'rescuePlan', label: 'Rescue plan', type: 'textarea', required: true },
      { key: 'ventilationMethod', label: 'Ventilation method', type: 'text', required: true },
      { key: 'entryExitLog', label: 'Entry / exit log', type: 'textarea', required: true },
    ],
  },
  WORKING_AT_HEIGHT: {
    label: 'Working at Height',
    fields: [
      { key: 'heightM', label: 'Height in metres', type: 'number', required: true },
      { key: 'accessMethod', label: 'Access method', type: 'select', required: true, options: ['Scaffold', 'Ladder', 'MEWP', 'Rope'] },
      { key: 'fallArrestEquipment', label: 'Fall arrest equipment', type: 'text', required: true },
      { key: 'anchorPointChecked', label: 'Anchor point checked', type: 'checkbox', required: true },
      { key: 'barricadingBelow', label: 'Barricading below', type: 'checkbox', required: true },
    ],
  },
  ELECTRICAL_LOTO: {
    label: 'Electrical / Isolation (LOTO)',
    fields: [
      { key: 'equipmentTag', label: 'Equipment tag', type: 'text', required: true },
      { key: 'voltageLevel', label: 'Voltage level', type: 'text', required: true },
      { key: 'isolationPoints', label: 'Isolation points list', type: 'textarea', required: true },
      { key: 'lockNumbers', label: 'Lock numbers', type: 'text', required: true },
      { key: 'tagNumbers', label: 'Tag numbers', type: 'text', required: true },
      { key: 'earthingApplied', label: 'Earthing applied', type: 'checkbox', required: true },
      { key: 'testedDeadBy', label: 'Tested dead by', type: 'text', required: true },
    ],
  },
};

const terminal: Status[] = ['EXPIRED', 'REJECTED', 'CLOSED_VERIFIED', 'CANCELLED'];
const allowedFrom: Record<string, Status[]> = {
  submit: ['DRAFT'],
  activate: ['APPROVED'],
  suspend: ['ACTIVE'],
  resume: ['SUSPENDED'],
  expire: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'SUSPENDED'],
  close: ['ACTIVE'],
  verify: ['CLOSED'],
  cancel: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'CLOSED'],
};

export function transition(
  status: Status,
  action: string,
  ctx: { allApproved?: boolean; now?: Date; plannedStart?: Date } = {},
): Status {
  if (!allowedFrom[action]?.includes(status) || terminal.includes(status)) {
    throw new Error(`Cannot ${action} a ${status} permit`);
  }
  if (action === 'activate' && !ctx.allApproved) throw new Error('Every required approver must approve before activation');
  if (action === 'activate' && ctx.plannedStart && ctx.now && ctx.now < ctx.plannedStart) {
    throw new Error('Permit cannot activate before planned start');
  }
  return (
    {
      submit: 'PENDING_APPROVAL',
      activate: 'ACTIVE',
      suspend: 'SUSPENDED',
      resume: 'ACTIVE',
      expire: 'EXPIRED',
      close: 'CLOSED',
      verify: 'CLOSED_VERIFIED',
      cancel: 'CANCELLED',
    } as Record<string, Status>
  )[action];
}

export function canApprove(role: Role, requesterId: string, userId: string, permitAreaId: string, userAreaId?: string | null) {
  if (requesterId === userId) return false;
  if (role === 'ADMIN' || role === 'SAFETY_OFFICER') return true;
  return role === 'AREA_OWNER' && userAreaId === permitAreaId;
}

export function requiredApprovalRole(role: Role) {
  if (role === 'AREA_OWNER') return 'AREA_OWNER';
  if (role === 'SAFETY_OFFICER' || role === 'ADMIN') return 'SAFETY_OFFICER';
  return null;
}

export function isTerminal(status: Status) {
  return terminal.includes(status);
}

export function validateTypeDetails(type: PermitType, details: Record<string, unknown>) {
  const config = permitTypes[type];
  if (!config) throw new Error('Unsupported permit type');
  const missing = config.fields
    .filter((field) => field.required)
    .filter((field) => {
      const value = details[field.key];
      if (field.type === 'checkbox') return value !== true && value !== 'true' && value !== 1;
      return value === undefined || value === null || value === '';
    })
    .map((field) => field.label);
  if (missing.length) throw new Error(`Missing required type fields: ${missing.join(', ')}`);
}

export function nonTerminalStatuses() {
  return ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'SUSPENDED'];
}
