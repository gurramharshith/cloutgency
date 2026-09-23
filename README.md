# Opmaint Permit to Work Module

A full-stack Permit to Work module for a CMMS, built for the Opmaint Web Development Intern assignment. The app models a shared permit core with type-specific fields for Hot Work, Confined Space Entry, Working at Height, and Electrical / LOTO permits.

## Tech Stack

- Frontend: browser app with TypeScript-backed API contract and responsive HTML/CSS/JS
- Backend: Node.js, Express, TypeScript
- Database: SQLite for local zero-config review, with a Postgres-compatible migration in `migrations/001_initial_schema.sql`
- Tests: Node test runner for state-machine and permission rules

## Run Locally

Requires Node 20+.

```bash
npm install
npm run seed
npm start
```

The server prints the exact URL when it starts. It prefers `http://localhost:3000`; if that port is already in use, it automatically tries `3001`, then the next available port. Open the URL printed in the terminal (for example, `http://localhost:3001`).

To force a particular free port in PowerShell:

```powershell
$env:PORT=3001
npm start
```

Useful commands:

```bash
npm test
npm run build
```

## Deploying to Vercel

This project includes `api/index.ts` and `vercel.json`, so Vercel invokes Express as a serverless function rather than trying to run a long-lived `npm start` process. On Vercel, SQLite is stored in the function's writable `/tmp` directory and the demo data is seeded automatically on a fresh instance.

Push these deployment files, then redeploy from the Vercel dashboard (or run `vercel --prod`). The first request may take a few seconds while the function initializes. Use the same demo credentials listed below.

`/tmp` is ephemeral in a serverless environment, so changes made in the hosted Vercel demo can be reset whenever the function is replaced. For persistent SQLite hosting, set `DB_PATH` to a writable path on a durable volume (for example, Render/Railway disk storage). For Postgres, apply the included migration and replace the SQLite adapter with a Postgres client.

## Demo Logins

| Role | Email | Password |
|---|---|---|
| Requester | `ravi@demo.com` | `ravi123` |
| Area Owner | `priya@demo.com` | `priya123` |
| Safety Officer | `anita@demo.com` | `anita123` |
| Admin | `admin@demo.com` | `dev123` |

Seed data creates 4 users, 2 plants, 3 areas, 6 equipment records, and 10 permits spread across Draft, Pending Approval, Approved, Active, Suspended, Closed, Closed Verified, Expired, Rejected, and Cancelled.

## What Is Implemented

- Email/password login with server-side sessions.
- Shared permit entity plus dynamic type-specific detail fields.
- Permit lifecycle enforced server-side: submit, approve/reject, activate, suspend, resume, expire, close, verify, cancel.
- Server-side checks for all required approvals, planned start time, terminal states, active-only work logs, role permissions, area-owner scope, and no self-approval.
- Dashboard filters by status, permit type, area, date range, and "my approvals pending".
- Active and expiring-in-two-hours dashboard counters, plus countdown text on active rows.
- Three-step create form (work/location, timing/controls, and permit-specific checks) that adapts to the selected permit type and saves as Draft.
- Permit detail view with full core data, type details, approval trail, actions available to the logged-in user, closure notes, work log, extension requests, and readable audit timeline.
- Approval queue and permit-detail approval actions: approve with comment/signature text or reject with a mandatory reason. The queue refreshes after a decision.
- Closure flow: requester closes with completion notes; safety officer/admin verifies with verification notes.
- Immutable audit entries for state changes, approvals/rejections, auto-expiry, field edits, work logs, and extension decisions.
- Extension request flow capped at 1-4 hours, safety/admin approval required.
- Conflict-relevant data model: time, plant, area, equipment and permit type are structured. A warning UI for hot-work/confined-space overlaps is the next step.
- Mobile-friendly layout with larger touch targets and responsive permit detail.

## Data Model Notes

The core permit fields live in `permits`; type-specific fields live in the `details` JSON column and are validated using the configuration in `src/domain.ts`. Adding a fifth permit type should mostly mean adding one config entry and, if needed, a few validation rules rather than copying a full form.

Required approvers are Area Owner and Safety Officer. Area Owners can only approve permits in their own area. Admins have full workflow access and can fulfil either pending approval slot, but no user—including an admin—can approve their own permit.

## Decisions and Tradeoffs

- SQLite is used for local review so the app runs quickly without external services. The included migration shows the intended relational schema for Postgres deployment.
- Expiry is checked by a one-minute server timer and also before reads/mutations, so stale permits cannot be acted on if no browser is open.
- Digital signature capture is implemented as typed signature text on approval. A canvas signature pad would be the production upgrade.
- The Admin screen creates users, plants, areas, and equipment; it also has full workflow authority, including either approval slot. Administrative deletion is deliberately omitted to preserve historical permit references.
- The frontend is a dependency-light app served by Express. The assignment prefers React; with more time I would port the current screens into React components without changing the API/domain layer.

## Known Limitations / What I Would Build Next

- The frontend is dependency-light browser JavaScript rather than React + TypeScript. The API and domain layers are TypeScript; a production iteration would move the screens into typed React components with component tests.
- Postgres deployment on Render/Railway with the migration applied.
- Conflict warning UI for overlapping Hot Work and Confined Space permits in the same area/equipment/time window.
- Canvas signature capture and QR code route per permit.
- Background worker for expiry and notification stubs for approvers.
- Richer admin screens for users, areas, and equipment.

There are no known broken core workflows after the final audit. Before submitting, run the seed command and test each demo role in the deployed environment.

## Final Audit Checklist

- `npm test` covers activation guards, terminal-state handling, approval scope/self-approval, approval-slot mapping, and type-detail validation.
- `npm run seed` resets the local database and produces the four demo users, two plants, six equipment records, and ten permits.
- Approval, closure, verification, extension, work-log, and admin-create requests are checked by the server rather than trusted from the UI.
- The UI only exposes available permit actions and refreshes the current dashboard, approval, closure, or admin view after a mutation.

## AI Use

AI was used to accelerate implementation, refactoring, README drafting, and test selection. The important decisions to be ready to explain are the shared permit model, type-field configuration, lifecycle state machine, server-side permission enforcement, and audit-trail design.
