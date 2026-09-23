let me = null;
let meta = null;
let permits = [];
let currentView = 'dashboard';
const $ = (selector) => document.querySelector(selector);
const typeName = (type) => meta?.permitTypes?.[type]?.label || type;
const byId = (rows, value) => rows.find((row) => row.id === value);

async function api(url, options = {}) {
  options.headers = { ...(options.headers || {}), 'Content-Type': 'application/json' };
  if (localStorage.ptwToken) options.headers.Authorization = `Bearer ${localStorage.ptwToken}`;
  const response = await fetch(url, options);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw Error(body?.error || 'Request failed');
  return body;
}

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
}

async function boot() {
  try {
    me = await api('/api/me');
    await loadApp();
  } catch {
    renderLogin();
  }
}

function renderLogin() {
  $('body').className = 'login-body';
  $('body').innerHTML = `
    <section class="login">
      <div>
        <p class="eyebrow">OPMAINT PTW</p>
        <h1>Permit to Work Control</h1>
        <p class="sub">Safety-critical permits with approvals, expiry, closure and audit trails.</p>
      </div>
      <form id="loginForm" class="login-card">
        <label>Email<input name="email" value="ravi@demo.com" required></label>
        <label>Password<input name="password" type="password" value="ravi123" required></label>
        <button class="primary">Log in</button>
        <p class="muted">Demo: ravi, priya, anita, admin @demo.com. Passwords: ravi123, priya123, anita123, dev123.</p>
      </form>
    </section>`;
  $('#loginForm').onsubmit = login;
}

async function login(event) {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(event.target));
  try {
    const result = await api('/api/auth/login', { method: 'POST', body: JSON.stringify(body) });
    localStorage.ptwToken = result.token;
    me = result.user;
    await loadApp();
  } catch (error) {
    alert(error.message);
  }
}

async function loadApp() {
  $('body').className = '';
  $('body').innerHTML = `
    <aside>
      <div class="brand">OP<span>MAINT</span></div>
      <p class="eyebrow">PERMIT TO WORK</p>
      <nav>
        <a id="nav-dashboard" onclick="renderDashboard()">Dashboard</a>
        <a id="nav-approvals" onclick="renderApprovals()">Approvals</a>
        <a id="nav-closure" onclick="renderClosure()">Closure</a>
        <a id="nav-admin" onclick="renderAdmin()">Admin</a>
      </nav>
      <div class="profile">
        <div class="user">${escapeHtml(me.name)}</div>
        <div class="muted">${me.role.replaceAll('_', ' ')}</div>
        <button onclick="logout()">Logout</button>
      </div>
    </aside>
    <main id="main">
    </main>
    <dialog id="modal"><button class="close" onclick="modal.close()">x</button><div id="modalbody"></div></dialog>`;
  meta = await api('/api/meta');
  await renderDashboard();
}

function setNav(view) {
  document.querySelectorAll('nav a').forEach((link) => link.classList.remove('selected'));
  $(`#nav-${view}`)?.classList.add('selected');
}

async function refreshMeta() {
  meta = await api('/api/meta');
}

async function renderDashboard() {
  currentView = 'dashboard';
  setNav('dashboard');
  $('#main').innerHTML = `
      <header>
        <div><h1>Permit Dashboard</h1><p class="sub">Active work, expiring permits, pending approvals and permit history.</p></div>
        ${['REQUESTER', 'ADMIN'].includes(me.role) ? '<button class="primary" onclick="openCreate()">+ New Permit</button>' : ''}
      </header>
      <section class="alerts">
        <div><b id="activeCount">0</b><span>Active permits now</span></div>
        <div class="warning"><b id="soonCount">0</b><span>Expiring in next 2 hours</span></div>
        <div><b id="approvalCount">0</b><span>My approvals pending</span></div>
      </section>
      <section class="toolbar">
        <select id="status"><option value="">All statuses</option></select>
        <select id="type"><option value="">All permit types</option></select>
        <select id="area"><option value="">All areas</option></select>
        <input id="from" type="date" title="From date">
        <input id="to" type="date" title="To date">
        <label class="check"><input id="mine" type="checkbox"> My approvals</label>
        <button onclick="load()">Apply</button>
      </section>
      <section class="tablewrap">
        <table>
          <thead><tr><th>Permit</th><th>Work</th><th>Validity</th><th>Status</th><th></th></tr></thead>
          <tbody id="rows"></tbody>
        </table>
      </section>
    `;
  fillFilters();
  await load();
}

function fillFilters() {
  const statuses = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE', 'SUSPENDED', 'EXPIRED', 'REJECTED', 'CLOSED', 'CLOSED_VERIFIED', 'CANCELLED'];
  $('#status').innerHTML += statuses.map((s) => `<option>${s}</option>`).join('');
  $('#type').innerHTML += Object.entries(meta.permitTypes).map(([id, config]) => `<option value="${id}">${config.label}</option>`).join('');
  $('#area').innerHTML += meta.areas.map((area) => `<option value="${area.id}">${area.name}</option>`).join('');
}

async function logout() {
  await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
  localStorage.removeItem('ptwToken');
  renderLogin();
}

async function load() {
  const params = new URLSearchParams();
  for (const id of ['status', 'type', 'area']) if ($(`#${id}`).value) params.set(id, $(`#${id}`).value);
  if ($('#from').value) params.set('from', new Date($('#from').value).toISOString());
  if ($('#to').value) params.set('to', new Date(`${$('#to').value}T23:59:59`).toISOString());
  if ($('#mine').checked) params.set('myApprovals', 'true');
  permits = await api(`/api/permits?${params}`);
  const nowMs = Date.now();
  $('#activeCount').textContent = permits.filter((p) => p.status === 'ACTIVE').length;
  $('#soonCount').textContent = permits.filter((p) => p.status === 'ACTIVE' && new Date(p.planned_end) - nowMs < 7_200_000 && new Date(p.planned_end) > nowMs).length;
  $('#approvalCount').textContent = (await api('/api/permits?myApprovals=true')).length;
  renderPermitRows(permits);
}

function renderPermitRows(rows) {
  renderPermitRowsInto($('#rows'), rows);
}

function renderPermitRowsInto(target, rows) {
  target.innerHTML = rows
    .map((p) => {
      const remaining = p.status === 'ACTIVE' ? `<div class="countdown">${timeLeft(p.planned_end)}</div>` : '';
      return `<tr>
        <td><div class="permit">${p.permit_no}</div><div class="muted">${escapeHtml(p.requester_name)}</div></td>
        <td>${typeName(p.type)}<div class="muted">${escapeHtml(p.description)}</div><div class="muted">${p.plant_name} / ${p.area_name} / ${p.equipment_tag || 'Unassigned'}</div></td>
        <td>${new Date(p.planned_start).toLocaleString()}<div class="muted">Ends ${new Date(p.planned_end).toLocaleString()}</div>${remaining}</td>
        <td><span class="badge ${p.status}">${p.status.replaceAll('_', ' ')}</span></td>
        <td><button onclick="detail('${p.id}')">View</button></td>
      </tr>`;
    })
    .join('');
}

async function renderApprovals() {
  currentView = 'approvals';
  setNav('approvals');
  $('#main').innerHTML = `
    <header>
      <div><h1>Approval Queue</h1><p class="sub">Permits waiting for your area-owner or safety approval.</p></div>
    </header>
    <section class="tablewrap">
      <table>
        <thead><tr><th>Permit</th><th>Work to Review</th><th>Validity</th><th>Status</th><th></th></tr></thead>
        <tbody id="rows"></tbody>
      </table>
    </section>`;
  const rows = await api('/api/permits?myApprovals=true');
  renderPermitRows(rows);
  if (!rows.length) $('#rows').innerHTML = `<tr><td colspan="5" class="empty">No approvals are pending for your role.</td></tr>`;
}

async function renderClosure() {
  currentView = 'closure';
  setNav('closure');
  $('#main').innerHTML = `
    <header>
      <div><h1>Closure</h1><p class="sub">Requester handback and safety verification queue.</p></div>
    </header>
    <section class="split">
      <div>
        <h3>Ready for requester close</h3>
        <div class="tablewrap"><table><thead><tr><th>Permit</th><th>Work</th><th>Validity</th><th>Status</th><th></th></tr></thead><tbody id="activeRows"></tbody></table></div>
      </div>
      <div>
        <h3>Ready for safety verification</h3>
        <div class="tablewrap"><table><thead><tr><th>Permit</th><th>Work</th><th>Validity</th><th>Status</th><th></th></tr></thead><tbody id="closedRows"></tbody></table></div>
      </div>
    </section>`;
  const active = await api('/api/permits?status=ACTIVE');
  const closed = await api('/api/permits?status=CLOSED');
  const closable = active.filter((p) => me.role === 'ADMIN' || p.requester_id === me.id);
  const verifiable = ['SAFETY_OFFICER', 'ADMIN'].includes(me.role) ? closed : [];
  renderPermitRowsInto($('#activeRows'), closable);
  renderPermitRowsInto($('#closedRows'), verifiable);
  if (!closable.length) $('#activeRows').innerHTML = `<tr><td colspan="5" class="empty">No active permits available for you to close.</td></tr>`;
  if (!verifiable.length) $('#closedRows').innerHTML = `<tr><td colspan="5" class="empty">No permits are waiting for safety verification.</td></tr>`;
}

async function renderAdmin() {
  currentView = 'admin';
  setNav('admin');
  if (me.role !== 'ADMIN') {
    $('#main').innerHTML = `<header><div><h1>Admin</h1><p class="sub">Only Admin users can manage users, areas and equipment.</p></div></header><section class="notice">You are logged in as ${me.role.replaceAll('_', ' ')}.</section>`;
    return;
  }
  await refreshMeta();
  const users = await api('/api/users');
  $('#main').innerHTML = `
    <header>
      <div><h1>Admin</h1><p class="sub">Manage users, plants, areas and equipment used by permits.</p></div>
    </header>
    <section class="admin-grid">
      <form class="panel form" onsubmit="createUser(event)">
        <h3 class="wide">Add user</h3>
        <label>Name<input name="name" required></label>
        <label>Email<input name="email" type="email" required></label>
        <label>Password<input name="password" required></label>
        <label>Role<select name="role"><option>REQUESTER</option><option>AREA_OWNER</option><option>SAFETY_OFFICER</option><option>ADMIN</option></select></label>
        <label class="wide">Area for Area Owner<select name="areaId"><option value="">None</option>${meta.areas.map((a) => `<option value="${a.id}">${a.name}</option>`).join('')}</select></label>
        <button class="primary wide">Create user</button>
      </form>
      <form class="panel form" onsubmit="createPlant(event)">
        <h3 class="wide">Add plant</h3>
        <label class="wide">Plant name<input name="name" required></label>
        <button class="primary wide">Create plant</button>
      </form>
      <form class="panel form" onsubmit="createArea(event)">
        <h3 class="wide">Add area</h3>
        <label>Plant<select name="plantId">${meta.plants.map((p) => `<option value="${p.id}">${p.name}</option>`).join('')}</select></label>
        <label>Area name<input name="name" required></label>
        <button class="primary wide">Create area</button>
      </form>
      <form class="panel form" onsubmit="createEquipment(event)">
        <h3 class="wide">Add equipment</h3>
        <label>Area<select name="areaId">${meta.areas.map((a) => `<option value="${a.id}">${a.name}</option>`).join('')}</select></label>
        <label>Tag<input name="tag" required></label>
        <label class="wide">Name<input name="name" required></label>
        <button class="primary wide">Create equipment</button>
      </form>
    </section>
    <section class="tablewrap">
      <table><thead><tr><th>User</th><th>Email</th><th>Role</th><th>Area</th></tr></thead>
      <tbody>${users.map((u) => `<tr><td>${escapeHtml(u.name)}</td><td>${escapeHtml(u.email)}</td><td>${u.role.replaceAll('_', ' ')}</td><td>${escapeHtml(byId(meta.areas, u.area_id)?.name || '-')}</td></tr>`).join('')}</tbody></table>
    </section>`;
}

function timeLeft(end) {
  const mins = Math.max(0, Math.floor((new Date(end) - Date.now()) / 60000));
  return `${Math.floor(mins / 60)}h ${mins % 60}m left`;
}

function detailsHtml(type, details) {
  return meta.permitTypes[type].fields
    .map((field) => `<div><b>${field.label}</b>${escapeHtml(details[field.key] === true ? 'Yes' : details[field.key] || 'No')}</div>`)
    .join('');
}

async function detail(id) {
  const p = await api(`/api/permits/${id}`);
  $('#modalbody').innerHTML = `
    <div class="details">
      <p class="eyebrow">${p.permit_no}</p>
      <h2>${typeName(p.type)}</h2>
      <span class="badge ${p.status}">${p.status.replaceAll('_', ' ')}</span>
      <div class="grid">
        <div><b>WORK</b>${escapeHtml(p.description)}<br><span class="muted">${escapeHtml(p.contractor)}</span></div>
        <div><b>LOCATION</b>${p.plant_name} / ${p.area_name} / ${p.equipment_tag || 'Unassigned'}</div>
        <div><b>VALIDITY</b>${new Date(p.planned_start).toLocaleString()} - ${new Date(p.planned_end).toLocaleString()}</div>
        <div><b>REQUESTER</b>${escapeHtml(p.requester_name)}</div>
        <div><b>HAZARDS</b>${escapeHtml(p.hazards)}</div>
        <div><b>PPE</b>${escapeHtml(p.ppe)}</div>
        <div class="wide"><b>PRECAUTIONS</b>${escapeHtml(p.precautions)}</div>
        ${detailsHtml(p.type, p.details)}
      </div>
      <h3>Approval trail</h3>
      ${p.approvals.map((a) => `<p><b>${a.role.replaceAll('_', ' ')}</b> - ${a.decision}${a.approver_name ? ` by ${escapeHtml(a.approver_name)}` : ''}${a.comment ? `: ${escapeHtml(a.comment)}` : ''}</p>`).join('')}
      <div class="actions">${p.allowedActions.map((a) => `<button onclick="action('${p.id}','${a}')">${labelAction(a)}</button>`).join('')}</div>
      <h3>Closure and work log</h3>
      <p>${escapeHtml(p.completion_notes || 'No completion notes yet.')}</p>
      ${p.workLogs.map((w) => `<p><b>${escapeHtml(w.actor_name)}</b> ${escapeHtml(w.note)} <span class="muted">${new Date(w.created_at).toLocaleString()}</span></p>`).join('')}
      <h3>Extension requests</h3>
      ${p.extensions.map((e) => `<p><b>+${e.hours}h</b> ${e.status} - ${escapeHtml(e.reason)} ${e.status === 'PENDING' && ['SAFETY_OFFICER', 'ADMIN'].includes(me.role) ? `<button onclick="decideExtension('${e.id}','APPROVED','${p.id}')">Approve</button><button onclick="decideExtension('${e.id}','REJECTED','${p.id}')">Reject</button>` : ''}</p>`).join('') || '<p class="muted">No extension requests.</p>'}
      <h3>Audit trail</h3>
      <div class="timeline">${p.audit.map((a) => `<p><b>${a.action.replaceAll('_', ' ')}</b> ${a.field ? `<span class="muted">${a.field}: ${escapeHtml(a.from_value || '-')} -> ${escapeHtml(a.to_value || '-')}</span>` : ''}<br><span class="muted">${escapeHtml(a.actor_name)} · ${new Date(a.created_at).toLocaleString()} ${a.comment ? `· ${escapeHtml(a.comment)}` : ''}</span></p>`).join('')}</div>
    </div>`;
  modal.showModal();
}

function labelAction(actionName) {
  return actionName.replaceAll('_', ' ').toUpperCase();
}

async function action(id, actionName) {
  const body = { action: actionName };
  if (['approve', 'reject', 'suspend', 'verify'].includes(actionName)) body.comment = prompt(actionName === 'reject' ? 'Reason required' : 'Comment') || '';
  if (actionName === 'approve') body.signature = prompt('Type your name as digital signature') || me.name;
  if (actionName === 'close') body.completionNotes = prompt('Completion notes') || 'Work completed and area handed back';
  if (actionName === 'verify') body.verificationNotes = prompt('Verification notes') || 'Area clean and safe';
  if (actionName === 'log_work') return logWork(id);
  if (actionName === 'request_extension') return requestExtension(id);
  try {
    await api(`/api/permits/${id}/action`, { method: 'POST', body: JSON.stringify(body) });
    modal.close();
    await refreshCurrentView();
  } catch (error) {
    alert(error.message);
  }
}

async function refreshCurrentView() {
  if (currentView === 'approvals') return renderApprovals();
  if (currentView === 'closure') return renderClosure();
  if (currentView === 'admin') return renderAdmin();
  return renderDashboard();
}

async function logWork(id) {
  const note = prompt('Work log note');
  if (!note) return;
  await api(`/api/permits/${id}/work-logs`, { method: 'POST', body: JSON.stringify({ note }) });
  await detail(id);
  await refreshCurrentView();
}

async function requestExtension(id) {
  const hours = Number(prompt('Extension hours (1-4)', '1'));
  const reason = prompt('Reason for extension');
  if (!hours || !reason) return;
  await api(`/api/permits/${id}/extensions`, { method: 'POST', body: JSON.stringify({ hours, reason }) });
  await detail(id);
}

async function decideExtension(extensionId, decision, permitId) {
  const comment = prompt('Comment') || '';
  await api(`/api/extensions/${extensionId}/decision`, { method: 'POST', body: JSON.stringify({ decision, comment }) });
  await detail(permitId);
  await refreshCurrentView();
}

async function submitAdminForm(event, url) {
  event.preventDefault();
  const body = Object.fromEntries(new FormData(event.target));
  try {
    await api(url, { method: 'POST', body: JSON.stringify(body) });
    await renderAdmin();
  } catch (error) {
    alert(error.message);
  }
}

function createUser(event) {
  return submitAdminForm(event, '/api/users');
}

function createPlant(event) {
  return submitAdminForm(event, '/api/plants');
}

function createArea(event) {
  return submitAdminForm(event, '/api/areas');
}

function createEquipment(event) {
  return submitAdminForm(event, '/api/equipment');
}

function openCreate() {
  const typeOptions = Object.entries(meta.permitTypes).map(([id, config]) => `<option value="${id}">${config.label}</option>`).join('');
  $('#modalbody').innerHTML = `
    <h2>New permit</h2>
    <form class="form" id="createForm">
      <p class="wide muted" id="createProgress">Step 1 of 3 — work and location</p>
      <div class="create-step wide form" data-step="1">
        <label>Permit type<select name="type" id="permitType">${typeOptions}</select></label>
        <label>Contractor / team<input name="contractor" value="Apex Engineering" required></label>
        <label class="wide">Work description<textarea name="description" required>Replace leaking flange gasket under isolation</textarea></label>
        <label>Plant<select name="plantId" id="plantSelect">${meta.plants.map((p) => `<option value="${p.id}">${p.name}</option>`).join('')}</select></label>
        <label>Area<select name="areaId" id="areaSelect"></select></label>
        <label class="wide">Equipment<select name="equipmentId" id="equipmentSelect"></select></label>
      </div>
      <div class="create-step wide form" data-step="2" hidden>
        <label>Start<input type="datetime-local" name="plannedStart" required></label>
        <label>End<input type="datetime-local" name="plannedEnd" required></label>
        <label>Hazards<input name="hazards" value="Flammable vapour; stored energy" required></label>
        <label>PPE<input name="ppe" value="Helmet, gloves, goggles, safety shoes" required></label>
        <label class="wide">Precautions<textarea name="precautions" required>Toolbox talk, barricade, gas testing, isolation verified</textarea></label>
      </div>
      <div class="create-step wide form" data-step="3" hidden><div id="typeFields" class="wide form inset"></div></div>
      <div class="wide wizard-actions">
        <button type="button" id="createBack" onclick="changeCreateStep(-1)" hidden>Back</button>
        <button type="button" id="createNext" class="primary" onclick="changeCreateStep(1)">Continue</button>
        <button type="submit" id="createSave" class="primary" hidden>Save Draft</button>
      </div>
    </form>`;
  const start = new Date(Date.now() + 60 * 60_000);
  const end = new Date(Date.now() + 4 * 60 * 60_000);
  document.querySelector('[name=plannedStart]').value = start.toISOString().slice(0, 16);
  document.querySelector('[name=plannedEnd]').value = end.toISOString().slice(0, 16);
  $('#permitType').onchange = renderTypeFields;
  $('#plantSelect').onchange = fillLocation;
  $('#areaSelect').onchange = fillEquipment;
  $('#createForm').onsubmit = create;
  fillLocation();
  renderTypeFields();
  modal.showModal();
}

function changeCreateStep(direction) {
  const form = $('#createForm');
  const current = Number(form.dataset.step || 1);
  if (direction > 0) {
    const fields = [...document.querySelectorAll(`.create-step[data-step="${current}"] input, .create-step[data-step="${current}"] select, .create-step[data-step="${current}"] textarea`)];
    if (!fields.every((field) => field.checkValidity())) {
      fields.find((field) => !field.checkValidity())?.reportValidity();
      return;
    }
  }
  showCreateStep(current + direction);
}

function showCreateStep(step) {
  const form = $('#createForm');
  form.dataset.step = String(step);
  document.querySelectorAll('.create-step').forEach((section) => { section.hidden = Number(section.dataset.step) !== step; });
  $('#createProgress').textContent = `Step ${step} of 3 — ${['work and location', 'timing and controls', 'permit-specific checks'][step - 1]}`;
  $('#createBack').hidden = step === 1;
  $('#createNext').hidden = step === 3;
  $('#createSave').hidden = step !== 3;
}

function fillLocation() {
  const plantId = $('#plantSelect').value;
  const areas = meta.areas.filter((area) => area.plant_id === plantId);
  $('#areaSelect').innerHTML = areas.map((area) => `<option value="${area.id}">${area.name}</option>`).join('');
  fillEquipment();
}

function fillEquipment() {
  const areaId = $('#areaSelect').value;
  $('#equipmentSelect').innerHTML = meta.equipment.filter((item) => item.area_id === areaId).map((item) => `<option value="${item.id}">${item.tag} - ${item.name}</option>`).join('');
}

function renderTypeFields() {
  const fields = meta.permitTypes[$('#permitType').value].fields;
  $('#typeFields').innerHTML = fields
    .map((field) => {
      if (field.type === 'select') return `<label>${field.label}<select name="detail_${field.key}">${field.options.map((option) => `<option>${option}</option>`).join('')}</select></label>`;
      if (field.type === 'textarea') return `<label class="wide">${field.label}<textarea name="detail_${field.key}" required></textarea></label>`;
      if (field.type === 'checkbox') return `<label class="check"><input type="checkbox" name="detail_${field.key}" checked> ${field.label}</label>`;
      return `<label>${field.label}<input type="${field.type}" name="detail_${field.key}" required></label>`;
    })
    .join('');
}

async function create(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const body = Object.fromEntries(form);
  const details = {};
  for (const [key, value] of form.entries()) if (key.startsWith('detail_')) details[key.replace('detail_', '')] = value || true;
  for (const field of meta.permitTypes[body.type].fields) if (field.type === 'checkbox') details[field.key] = form.has(`detail_${field.key}`);
  body.details = details;
  body.plannedStart = new Date(body.plannedStart).toISOString();
  body.plannedEnd = new Date(body.plannedEnd).toISOString();
  try {
    await api('/api/permits', { method: 'POST', body: JSON.stringify(body) });
    modal.close();
    await refreshCurrentView();
  } catch (error) {
    alert(error.message);
  }
}

boot();
