// Vercel serverless entry point. Express is exported rather than listening on
// a port; Vercel invokes this handler for both UI and API routes.
import app from '../src/server.js';

export default app;
