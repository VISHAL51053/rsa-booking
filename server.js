const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ExcelJS = require('exceljs');
const { Pool, types } = require('pg');
if (types && typeof types.setTypeParser === 'function') {
  // Parse PostgreSQL DATE (OID 1082) directly as YYYY-MM-DD string to avoid timezone shifting
  types.setTypeParser(1082, (val) => val);
}

require('dotenv').config({ quiet: true });

function getDatabaseSsl(url) {
  if (!url) return undefined;
  if (url.includes('localhost') || url.includes('127.0.0.1')) return undefined;
  return { rejectUnauthorized: false };
}

const root = __dirname;
const port = Number(process.env.PORT) || 3000;
const adminUsername = (process.env.ADMIN_USERNAME || 'admin').trim();
const adminPassword = process.env.ADMIN_PASSWORD || '';
const adminPasswordSalt = crypto.randomBytes(16);
const adminPasswordHash = adminPassword.length >= 12 ? crypto.scryptSync(adminPassword, adminPasswordSalt, 64) : null;
const loginConfigured = Boolean(adminUsername && adminPasswordHash);
const databaseUrl = process.env.DATABASE_URL || '';
const databasePool = databaseUrl ? new Pool({
  connectionString: databaseUrl,
  ssl: getDatabaseSsl(databaseUrl),
  connectionTimeoutMillis: 10_000,
  idleTimeoutMillis: 30_000,
  max: 5,
}) : null;
const workbookPath = path.resolve(root, process.env.BOOKINGS_WORKBOOK_PATH || 'data/bookings.xlsx');
const workbookHeaders = ['SubmittedAt', 'PlayerName', 'MobileNumber', 'PlayDate', 'Court', 'Membership', 'Players', 'FeeINR'];
const rates = { 'One-day': 100, Weekly: 500, Monthly: 1000 };
const publicFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/branding.css', ['branding.css', 'text/css; charset=utf-8']],
  ['/membership.css', ['membership.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/admin', ['admin.html', 'text/html; charset=utf-8']],
  ['/admin/', ['admin.html', 'text/html; charset=utf-8']],
  ['/admin.css', ['admin.css', 'text/css; charset=utf-8']],
  ['/admin.js', ['admin.js', 'text/javascript; charset=utf-8']],
]);
const sessions = new Map();
const requestsByAddress = new Map();
const requestLimit = 8;
const requestWindowMs = 60_000;
const sessionLifetimeMs = 8 * 60 * 60 * 1000;
const cookieName = 'rsa_admin';
let workbookQueue = Promise.resolve();
let databaseSchemaPromise;

function sendJson(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(JSON.stringify(body));
}

function setSecurityHeaders(response) {
  response.setHeader('x-content-type-options', 'nosniff');
  response.setHeader('x-frame-options', 'DENY');
  response.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  response.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  response.setHeader('content-security-policy', "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'self'; frame-ancestors 'none'");
}

function setAdminCookie(response, request, value, maxAge) {
  const secure = process.env.NODE_ENV === 'production' || request.headers['x-forwarded-proto'] === 'https';
  response.setHeader('set-cookie', `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? '; Secure' : ''}`);
}

function getCookie(request, name) {
  const cookieHeader = request.headers.cookie || '';
  for (const item of cookieHeader.split(';')) {
    const [key, ...value] = item.trim().split('=');
    if (key === name) {
      try { return decodeURIComponent(value.join('=')); } catch { return ''; }
    }
  }
  return '';
}

function getAdminSession(request) {
  const sessionId = getCookie(request, cookieName);
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return null;
  }
  return { ...session, sessionId };
}

function requireSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00`);
  return Number.isFinite(date.getTime()) && localDateString(date) === value;
}

function validateBooking(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const playerName = typeof value.playerName === 'string' ? value.playerName.trim() : '';
  const mobileNumber = typeof value.mobileNumber === 'string' ? value.mobileNumber.trim() : '';
  const digits = mobileNumber.replace(/\D/g, '');
  const players = Number(value.players);
  const today = localDateString();

  if (playerName.length < 1 || playerName.length > 60) return null;
  if (digits.length < 7 || digits.length > 15 || mobileNumber.length > 24) return null;
  if (!parseDate(value.playDate) || value.playDate < today) return null;
  if (!['Court 1', 'Court 2'].includes(value.court)) return null;
  if (!Object.hasOwn(rates, value.membership)) return null;
  if (!Number.isInteger(players) || players < 1 || players > 20) return null;

  const feeINR = rates[value.membership] * (value.membership === 'One-day' ? players : 1);
  return {
    submittedAt: new Date().toISOString(),
    playerName,
    mobileNumber,
    playDate: value.playDate,
    court: value.court,
    membership: value.membership,
    players,
    feeINR,
  };
}

function getClientIp(request) {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return request.socket?.remoteAddress || 'unknown';
}

function allowedByRateLimit(address, limit = requestLimit, windowMs = requestWindowMs) {
  const now = Date.now();
  const recent = (requestsByAddress.get(address) || []).filter((timestamp) => now - timestamp < windowMs);
  if (recent.length >= limit) {
    requestsByAddress.set(address, recent);
    return false;
  }
  recent.push(now);
  requestsByAddress.set(address, recent);

  // Periodic cleanup if map grows
  if (requestsByAddress.size > 200) {
    for (const [key, timestamps] of requestsByAddress.entries()) {
      const active = timestamps.filter((t) => now - t < 15 * 60_000);
      if (active.length === 0) requestsByAddress.delete(key);
      else requestsByAddress.set(key, active);
    }
  }
  return true;
}

function withWorkbookLock(operation) {
  const next = workbookQueue.then(operation, operation);
  workbookQueue = next.catch(() => {});
  return next;
}

async function ensureDatabaseSchema() {
  if (!databasePool) return;
  if (!databaseSchemaPromise) {
    databaseSchemaPromise = (async () => {
      await databasePool.query(`
        CREATE TABLE IF NOT EXISTS public.bookings (
          id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
          submitted_at TIMESTAMPTZ NOT NULL,
          player_name TEXT NOT NULL,
          mobile_number TEXT NOT NULL,
          play_date DATE NOT NULL,
          court TEXT NOT NULL CHECK (court IN ('Court 1', 'Court 2')),
          membership TEXT NOT NULL CHECK (membership IN ('One-day', 'Weekly', 'Monthly')),
          players INTEGER NOT NULL CHECK (players BETWEEN 1 AND 20),
          fee_inr INTEGER NOT NULL CHECK (fee_inr >= 0)
        );
      `);
      try {
        await databasePool.query(`
          DO $$
          BEGIN
            ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
              REVOKE ALL ON TABLE public.bookings FROM anon;
            END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
              REVOKE ALL ON TABLE public.bookings FROM authenticated;
            END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
              GRANT ALL ON TABLE public.bookings TO postgres;
            END IF;
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
              GRANT ALL ON TABLE public.bookings TO service_role;
            END IF;
          EXCEPTION WHEN OTHERS THEN
            NULL;
          END $$;
        `);
      } catch (rlsError) {
        console.warn('RLS configuration warning (non-fatal):', rlsError.message);
      }
    })().catch((error) => {
      databaseSchemaPromise = null;
      throw error;
    });
  }
  await databaseSchemaPromise;
}

async function openBookingsWorkbook() {
  await fs.promises.mkdir(path.dirname(workbookPath), { recursive: true });
  const workbook = new ExcelJS.Workbook();
  let worksheet;
  let table;

  if (fs.existsSync(workbookPath)) {
    await workbook.xlsx.readFile(workbookPath);
    worksheet = workbook.getWorksheet('Bookings') || workbook.addWorksheet('Bookings');
    table = worksheet.getTable('Bookings');
    if (table && (!table.worksheet || !Array.isArray(table.table.rows) || !table.table.ref)) {
      const existingRows = [];
      worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber < 2) return;
        const values = workbookHeaders.map((_, index) => row.getCell(index + 1).value);
        if (values.some((value) => value !== null && value !== undefined && value !== '')) existingRows.push(values);
      });
      worksheet.removeTable('Bookings');
      table = worksheet.addTable({
        name: 'Bookings',
        ref: 'A1',
        headerRow: true,
        totalsRow: false,
        style: { theme: 'TableStyleMedium4', showRowStripes: true },
        columns: workbookHeaders.map((name) => ({ name })),
        rows: existingRows,
      });
    }
  } else {
    worksheet = workbook.addWorksheet('Bookings');
  }

  if (!table) {
    const existingRows = [];
    if (worksheet.rowCount > 1) {
      worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        if (rowNumber < 2) return;
        const values = workbookHeaders.map((_, index) => row.getCell(index + 1).value);
        if (values.some((value) => value !== null && value !== undefined && value !== '')) existingRows.push(values);
      });
    }
    try { worksheet.removeTable('Bookings'); } catch {}
    table = worksheet.addTable({
      name: 'Bookings',
      ref: 'A1',
      headerRow: true,
      totalsRow: false,
      style: { theme: 'TableStyleMedium4', showRowStripes: true },
      columns: workbookHeaders.map((name) => ({ name })),
      rows: existingRows,
    });
    worksheet.views = [{ state: 'frozen', ySplit: 1 }];
    worksheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    await workbook.xlsx.writeFile(workbookPath);
  }

  return { workbook, worksheet, table };
}

async function appendBooking(booking) {
  if (databasePool) {
    await ensureDatabaseSchema();
    await databasePool.query(
      `INSERT INTO public.bookings
        (submitted_at, player_name, mobile_number, play_date, court, membership, players, fee_inr)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [booking.submittedAt, booking.playerName, booking.mobileNumber, booking.playDate,
        booking.court, booking.membership, booking.players, booking.feeINR],
    );
    return;
  }

  return withWorkbookLock(async () => {
    const { workbook, table } = await openBookingsWorkbook();
    table.addRow([
      booking.submittedAt,
      booking.playerName,
      booking.mobileNumber,
      booking.playDate,
      booking.court,
      booking.membership,
      booking.players,
      booking.feeINR,
    ]);
    table.commit();
    await workbook.xlsx.writeFile(workbookPath);
  });
}

function excelCell(row, column) {
  const value = row.getCell(column).value;
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object' && 'text' in value) return String(value.text);
  return value ?? '';
}

function normalizeDateString(dateVal) {
  if (!dateVal) return '';
  if (typeof dateVal === 'string') {
    // If it's already YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}/.test(dateVal)) return dateVal.slice(0, 10);
  }
  const parsed = new Date(dateVal);
  if (!Number.isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  return String(dateVal).slice(0, 10);
}

async function readBookings() {
  if (databasePool) {
    await ensureDatabaseSchema();
    const result = await databasePool.query(
      `SELECT id, submitted_at, player_name, mobile_number, play_date, court, membership, players, fee_inr
       FROM public.bookings
       ORDER BY submitted_at DESC, id DESC`,
    );
    return result.rows.map((row) => ({
      id: String(row.id),
      submittedAt: row.submitted_at instanceof Date ? row.submitted_at.toISOString() : String(row.submitted_at),
      playerName: row.player_name,
      mobileNumber: row.mobile_number,
      playDate: normalizeDateString(row.play_date),
      court: row.court,
      membership: row.membership,
      players: Number(row.players),
      feeINR: Number(row.fee_inr),
    }));
  }

  return withWorkbookLock(async () => {
    const { worksheet } = await openBookingsWorkbook();
    const rows = [];
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      rows.push({
        id: String(rowNumber - 2),
        submittedAt: String(excelCell(row, 1)),
        playerName: String(excelCell(row, 2)),
        mobileNumber: String(excelCell(row, 3)),
        playDate: String(excelCell(row, 4)).slice(0, 10),
        court: String(excelCell(row, 5)),
        membership: String(excelCell(row, 6)),
        players: Number(excelCell(row, 7)) || 0,
        feeINR: Number(excelCell(row, 8)) || 0,
      });
    });
    return rows.reverse();
  });
}

async function exportWorkbook(response) {
  let buffer;
  if (databasePool) {
    const rows = await readBookings();
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Bookings');
    worksheet.addTable({
      name: 'Bookings',
      ref: 'A1',
      headerRow: true,
      totalsRow: false,
      style: { theme: 'TableStyleMedium4', showRowStripes: true },
      columns: workbookHeaders.map((name) => ({ name })),
      rows: rows.map((booking) => [booking.submittedAt, booking.playerName, booking.mobileNumber,
        booking.playDate, booking.court, booking.membership, booking.players, booking.feeINR]),
    });
    buffer = await workbook.xlsx.writeBuffer();
  } else {
    buffer = await withWorkbookLock(async () => {
      const { workbook } = await openBookingsWorkbook();
      return workbook.xlsx.writeBuffer();
    });
  }

  response.writeHead(200, {
    'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'content-disposition': 'attachment; filename="rainbow-sports-bookings.xlsx"',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  response.end(Buffer.from(buffer));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 10_000) throw new Error('Request is too large.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function handleBooking(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('allow', 'POST');
    return sendJson(response, 405, { error: 'Method not allowed.' });
  }
  if (!requireSameOrigin(request)) return sendJson(response, 403, { error: 'Request not allowed.' });

  const address = getClientIp(request);
  if (!allowedByRateLimit(address)) return sendJson(response, 429, { error: 'Too many attempts. Please wait a minute and try again.' });

  let payload;
  try {
    payload = await readJson(request);
  } catch {
    return sendJson(response, 400, { error: 'Invalid booking request.' });
  }

  if (payload.website) return sendJson(response, 202, { ok: true });
  const booking = validateBooking(payload);
  if (!booking) return sendJson(response, 400, { error: 'Check the booking details and try again.' });

  try {
    await appendBooking(booking);
    return sendJson(response, 201, { ok: true });
  } catch (error) {
    console.error('Booking storage write failed:', {
      message: error.message,
      code: error.code || 'UNKNOWN',
      backend: databasePool ? 'supabase-postgresql' : 'local-excel',
      workbookPath: databasePool ? undefined : workbookPath,
      stack: error.stack,
    });
    return sendJson(response, 503, { error: 'We could not save your booking. Please contact the academy.' });
  }
}

async function handleAdminApi(request, response, pathname) {
  if (pathname === '/api/admin/session' && request.method === 'GET') {
    const session = getAdminSession(request);
    return sendJson(response, 200, {
      authenticated: Boolean(session),
      username: session?.username || '',
      loginConfigured,
    });
  }

  if (pathname === '/api/admin/login' && request.method === 'POST') {
    if (!requireSameOrigin(request)) return sendJson(response, 403, { error: 'Request not allowed.' });
    if (!loginConfigured) return sendJson(response, 503, { error: 'Admin login is not configured. Contact the academy administrator.' });
    const address = getClientIp(request);
    if (!allowedByRateLimit(`login:${address}`, 5, 15 * 60_000)) return sendJson(response, 429, { error: 'Too many sign-in attempts. Wait 15 minutes and try again.' });

    let credentials;
    try { credentials = await readJson(request); } catch { return sendJson(response, 400, { error: 'Invalid sign-in request.' }); }
    const username = typeof credentials.username === 'string' ? credentials.username.trim() : '';
    const password = typeof credentials.password === 'string' ? credentials.password : '';
    if (username.length > 80 || password.length > 256) return sendJson(response, 401, { error: 'Incorrect username or password.' });

    const submittedHash = crypto.scryptSync(password, adminPasswordSalt, 64);
    const passwordMatches = crypto.timingSafeEqual(adminPasswordHash, submittedHash);
    if (username !== adminUsername || !passwordMatches) return sendJson(response, 401, { error: 'Incorrect username or password.' });

    const sessionId = crypto.randomBytes(32).toString('base64url');
    sessions.set(sessionId, { username, expiresAt: Date.now() + sessionLifetimeMs });
    setAdminCookie(response, request, sessionId, Math.floor(sessionLifetimeMs / 1000));
    return sendJson(response, 200, { ok: true, username });
  }

  if (pathname === '/api/admin/logout' && request.method === 'POST') {
    if (!requireSameOrigin(request)) return sendJson(response, 403, { error: 'Request not allowed.' });
    const session = getAdminSession(request);
    if (session) sessions.delete(session.sessionId);
    setAdminCookie(response, request, '', 0);
    return sendJson(response, 200, { ok: true });
  }

  if (pathname === '/api/admin/bookings' && request.method === 'GET') {
    if (!getAdminSession(request)) return sendJson(response, 401, { error: 'Please sign in as an academy administrator.' });
    try {
      const rows = await readBookings();
      return sendJson(response, 200, { rows });
    } catch (error) {
      console.error('Booking storage read failed:', {
        message: error.message,
        code: error.code || 'UNKNOWN',
        backend: databasePool ? 'supabase-postgresql' : 'local-excel',
        workbookPath: databasePool ? undefined : workbookPath,
        stack: error.stack,
      });
      return sendJson(response, 503, { error: 'Could not load bookings from storage. Please try again.' });
    }
  }

  if (pathname === '/api/admin/workbook' && request.method === 'GET') {
    if (!getAdminSession(request)) return sendJson(response, 401, { error: 'Please sign in as an academy administrator.' });
    try {
      return await exportWorkbook(response);
    } catch (error) {
      console.error('Booking export failed:', {
        message: error.message,
        code: error.code || 'UNKNOWN',
        backend: databasePool ? 'supabase-postgresql' : 'local-excel',
        workbookPath: databasePool ? undefined : workbookPath,
        stack: error.stack,
      });
      return sendJson(response, 503, { error: 'Could not export the Excel workbook.' });
    }
  }

  response.setHeader('allow', 'GET, POST');
  return sendJson(response, 405, { error: 'Method not allowed.' });
}

async function readStaticFile(request, response, pathname) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('allow', 'GET, HEAD');
    return sendJson(response, 405, { error: 'Method not allowed.' });
  }
  const file = publicFiles.get(pathname);
  if (!file) return sendJson(response, 404, { error: 'Not found.' });

  const [filename, contentType] = file;
  try {
    const content = await fs.promises.readFile(path.join(root, filename));
    response.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-cache' });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch {
    sendJson(response, 500, { error: 'Unable to load the app page.' });
  }
}

const server = http.createServer(async (request, response) => {
  setSecurityHeaders(response);
  const requestUrl = new URL(request.url, 'http://localhost');
  const { pathname } = requestUrl;

  try {
    if (pathname === '/api/bookings') return await handleBooking(request, response);
    if (pathname.startsWith('/api/admin/')) return await handleAdminApi(request, response, pathname);
    return await readStaticFile(request, response, pathname);
  } catch {
    return sendJson(response, 500, { error: 'The request could not be completed.' });
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Rainbow Sports Academy booking app listening on port ${port}`);
  console.log(databasePool ? 'Booking storage: Supabase/PostgreSQL' : `Local Excel bookings are stored at ${workbookPath}`);
  if (!loginConfigured) console.warn('Admin login is not configured; set ADMIN_PASSWORD to a private password of at least 12 characters.');
});