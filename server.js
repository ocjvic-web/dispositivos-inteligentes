const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { spawn } = require('child_process');

const rootDir = __dirname;
const distRootDir = path.join(rootDir, 'dist', 'pagina-web');
const distDir = fs.existsSync(path.join(distRootDir, 'browser'))
  ? path.join(distRootDir, 'browser')
  : distRootDir;
const publicRootDir = path.join(rootDir, 'public');
const publicBiomedicaDir = path.join(rootDir, 'public', 'biomedica');
const assetsDir = path.join(rootDir, 'src', 'assets');
const port = process.env.PORT || 4300;
const adminUsername = process.env.ADMIN_USERNAME || '';
const adminPassword = process.env.ADMIN_PASSWORD || '';
const sessionSecret = process.env.SESSION_SECRET || '';
const sessionTtlMs = Number(process.env.SESSION_TTL_MS || 1000 * 60 * 60 * 8);
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabasePublishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || '';
const coreApiUrl = process.env.BIOMEDICA_CORE_API_URL
  || 'https://app-biomedica-web.onrender.com';
const testRunnerCooldowns = new Map();
const testRunnerCooldownMs = 5 * 60 * 1000;
const testRuns = new Map();
const testRunRetentionMs = 3 * 60 * 60 * 1000;
const testRunCommandTimeoutMs = 15 * 60 * 1000;
const testRunMaxLogTailLength = 8000;
let activeTestRunId = null;

function nowIso() {
  return new Date().toISOString();
}

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
    createdAt: user.createdAt,
    lastLoginAt: user.lastLoginAt || null,
  };
}

function signSession(payload) {
  return crypto
    .createHmac('sha256', sessionSecret)
    .update(JSON.stringify(payload))
    .digest('hex');
}

function generateToken(user) {
  const expiresAtMs = Date.now() + sessionTtlMs;
  const payload = {
    sub: user.id,
    username: user.username,
    role: user.role,
    expiresAtMs,
    nonce: crypto.randomBytes(16).toString('hex'),
  };
  const signature = signSession(payload);
  return `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${signature}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) {
    return null;
  }

  const [encodedPayload, signature] = token.split('.');
  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    if (signSession(payload) !== signature) {
      return null;
    }
    if (Date.now() > Number(payload.expiresAtMs)) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function extractBearerToken(req) {
  const raw = req.headers.authorization || '';
  if (!raw.startsWith('Bearer ')) {
    return '';
  }
  return raw.slice('Bearer '.length).trim();
}

function unauthorized(res, message = 'Unauthorized') {
  sendJson(res, 401, { error: message });
}

function forbidden(res, message = 'Forbidden') {
  sendJson(res, 403, { error: message });
}

function validatePasswordStrength(password) {
  return typeof password === 'string'
    && password.length >= 8
    && /[A-Z]/.test(password)
    && /[a-z]/.test(password)
    && /\d/.test(password)
    && /[^A-Za-z0-9]/.test(password);
}

function inferWearableName(wearableId, wearableFormFactor = 'desconocido') {
  const suffix = String(wearableId).slice(-6).toUpperCase();
  if (wearableFormFactor === 'square') {
    return `Wear OS Square ${suffix}`;
  }
  if (wearableFormFactor === 'round') {
    return `Wear OS Round ${suffix}`;
  }
  return `Wear OS ${suffix}`;
}

function createWearableRecord(wearableId, source = 'wear-os-remote', wearableFormFactor = 'desconocido') {
  return {
    id: wearableId,
    nombre: inferWearableName(wearableId, wearableFormFactor),
    modelo: wearableFormFactor === 'square'
      ? 'Emulador Wear OS cuadrado'
      : wearableFormFactor === 'round'
        ? 'Emulador Wear OS redondo'
        : (source === 'wear-os-emulator' ? 'Emulador Wear OS remoto' : 'Wearable remoto conectado'),
    estado: 'Conectado',
    bateria: 100,
    ritmoCardiaco: 72,
    spo2: 98,
    temperatura: 36.6,
    ubicacion: wearableFormFactor === 'square' ? 'Sesion remota · reloj cuadrado' : wearableFormFactor === 'round' ? 'Sesion remota · reloj redondo' : 'Sesion remota del profesor',
  };
}

function createTelemetrySnapshot(wearableId, previousTelemetry, body = {}) {
  return {
    wearableId,
    heartRate: Number(body.heartRate) || previousTelemetry.heartRate,
    spo2: Number(body.spo2) || previousTelemetry.spo2,
    temperature: Number(body.temperature) || previousTelemetry.temperature,
    battery: Number(body.battery) || previousTelemetry.battery,
    steps: Number(body.steps) || previousTelemetry.steps,
    stress: Number(body.stress) || previousTelemetry.stress,
    respiratoryRate: Number(body.respiratoryRate) || previousTelemetry.respiratoryRate,
    hrv: Number(body.hrv) || previousTelemetry.hrv,
    signalQuality: Number(body.signalQuality) || previousTelemetry.signalQuality,
    perfusionIndex: Number(body.perfusionIndex) || previousTelemetry.perfusionIndex,
    sequence: Number(body.sequence) || ((previousTelemetry.sequence || 0) + 1),
    source: body.source || previousTelemetry.source,
    timestamp: nowIso(),
  };
}

const initialTelemetry = {
  wearableId: '',
  heartRate: 0,
  spo2: 0,
  temperature: 0,
  battery: 0,
  steps: 0,
  stress: 0,
  respiratoryRate: 0,
  hrv: 0,
  signalQuality: 0,
  perfusionIndex: 0,
  sequence: 0,
  source: 'cloud-idle',
  timestamp: nowIso(),
};
const maxTelemetryHistory = 120;

const state = {
  wearables: [],
  tvs: [
    {
      id: 'tv-lg-01',
      nombre: 'LG OLED webOS 24',
      plataforma: 'LG webOS',
      resolucion: '4K UHD',
      sala: 'Consultorio principal',
      estado: 'Disponible',
      appActiva: 'BioMedica TV Hub',
    },
    {
      id: 'tv-lg-02',
      nombre: 'LG NanoCell webOS',
      plataforma: 'LG webOS',
      resolucion: '4K HDR',
      sala: 'Sala de telemetría',
      estado: 'Disponible',
      appActiva: 'BioMedica TV Hub',
    },
    {
      id: 'tv-samsung-01',
      nombre: 'Samsung Smart TV',
      plataforma: 'Samsung Tizen',
      resolucion: '4K UHD',
      sala: 'Sala de espera',
      estado: 'Disponible',
      appActiva: 'BioMedica TV Hub',
    },
    {
      id: 'tv-android-01',
      nombre: 'Android TV',
      plataforma: 'Android TV',
      resolucion: '4K UHD',
      sala: 'Consultorio 2',
      estado: 'Disponible',
      appActiva: 'BioMedica TV Hub',
    },
  ],
  activeWearableId: '',
  activeTvId: 'tv-lg-01',
  tvPaired: false,
  lastTelemetry: { ...initialTelemetry },
  telemetryHistory: [],
  telemetryByWearable: {},
  telemetryHistoryByWearable: {},
  adminUsers: [
    {
      id: 'admin-001',
      username: adminUsername,
      displayName: 'Administrador General',
      role: 'superadmin',
      status: 'activo',
      passwordHash: hashPassword(adminPassword),
      createdAt: nowIso(),
      lastLoginAt: null,
    },
  ],
  appointments: [
    {
      id: 'turno-001',
      codigo: 'A-101',
      paciente: 'Lucia Hernandez',
      servicio: 'Cardiologia',
      sala: 'Consultorio 2',
      prioridad: 'alta',
      estado: 'en_atencion',
      etaMin: 0,
      updatedAt: nowIso(),
    },
    {
      id: 'turno-002',
      codigo: 'A-102',
      paciente: 'Carlos Ramirez',
      servicio: 'Telemetria',
      sala: 'Modulo A',
      prioridad: 'media',
      estado: 'en_espera',
      etaMin: 6,
      updatedAt: nowIso(),
    },
    {
      id: 'turno-003',
      codigo: 'A-103',
      paciente: 'Sofia Vega',
      servicio: 'Neurologia',
      sala: 'Consultorio 4',
      prioridad: 'baja',
      estado: 'en_espera',
      etaMin: 14,
      updatedAt: nowIso(),
    },
  ],
};

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.apk': 'application/vnd.android.package-archive',
  '.wasm': 'application/wasm',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()'
  });
  res.end(JSON.stringify(payload));
}

async function isActiveSupabaseAccount(authorization) {
  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error('Supabase no está configurado en el servidor.');
  }
  const baseUrl = supabaseUrl.replace(/\/+$/, '');
  const headers = {
    apikey: supabasePublishableKey,
    authorization,
  };
  const userResponse = await fetch(`${baseUrl}/auth/v1/user`, { headers });
  if (userResponse.status === 401) return null;
  if (!userResponse.ok) {
    throw new Error(`No se pudo validar la sesión de Supabase (HTTP ${userResponse.status}).`);
  }
  const user = await userResponse.json();
  if (typeof user.id !== 'string') return false;

  const profileUrl = new URL(`${baseUrl}/rest/v1/profiles`);
  profileUrl.searchParams.set('id', `eq.${user.id}`);
  profileUrl.searchParams.set('select', 'is_active');
  const profileResponse = await fetch(profileUrl, { headers });
  if (!profileResponse.ok) {
    throw new Error(`No se pudo validar el estado de la cuenta (HTTP ${profileResponse.status}).`);
  }
  const profiles = await profileResponse.json();
  return Array.isArray(profiles) && profiles.length === 1 && profiles[0].is_active === true;
}

async function authorizeTestRunnerAdmin(req, res) {
  const accessToken = extractBearerToken(req);
  if (!accessToken) {
    unauthorized(res, 'Inicia sesión como administrador para ejecutar las pruebas.');
    return null;
  }
  if (!supabaseUrl || !supabasePublishableKey) {
    sendJson(res, 503, { error: 'El servicio de pruebas no está configurado.' });
    return null;
  }

  const baseUrl = supabaseUrl.replace(/\/+$/, '');
  const headers = {
    apikey: supabasePublishableKey,
    authorization: `Bearer ${accessToken}`,
  };
  try {
    const userResponse = await fetch(`${baseUrl}/auth/v1/user`, {
      headers,
      signal: AbortSignal.timeout(10000),
    });
    if (userResponse.status === 401 || userResponse.status === 403) {
      unauthorized(res, 'La sesión expiró. Inicia sesión nuevamente.');
      return null;
    }
    if (!userResponse.ok) {
      sendJson(res, 502, { error: 'No se pudo validar la sesión administrativa.' });
      return null;
    }

    const user = await userResponse.json();
    if (typeof user.id !== 'string' || !user.id) {
      unauthorized(res, 'La sesión no tiene un usuario válido.');
      return null;
    }

    const profileUrl = new URL(`${baseUrl}/rest/v1/profiles`);
    profileUrl.searchParams.set('id', `eq.${user.id}`);
    profileUrl.searchParams.set('select', 'role,is_active');
    const profileResponse = await fetch(profileUrl, {
      headers,
      signal: AbortSignal.timeout(10000),
    });
    if (profileResponse.status === 401 || profileResponse.status === 403) {
      forbidden(res, 'No tienes permiso para consultar las pruebas.');
      return null;
    }
    if (!profileResponse.ok) {
      sendJson(res, 502, { error: 'No se pudo validar el rol administrativo.' });
      return null;
    }

    const profiles = await profileResponse.json();
    const profile = Array.isArray(profiles) ? profiles[0] : null;
    if (!profile || profile.is_active !== true || profile.role !== 'admin') {
      forbidden(res, 'Solo un administrador activo puede ejecutar las pruebas.');
      return null;
    }
    return user.id;
  } catch (error) {
    console.error('Test runner authentication failed:', error.message);
    sendJson(res, 502, { error: 'No se pudo validar el acceso para las pruebas.' });
    return null;
  }
}

function createTestRunTicket(requestId, userId) {
  const payload = Buffer.from(JSON.stringify({
    requestId,
    userId,
    expiresAt: Date.now() + 3 * 60 * 60 * 1000,
  })).toString('base64url');
  const signature = crypto
    .createHmac('sha256', sessionSecret)
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

function verifyTestRunTicket(ticket) {
  if (!sessionSecret || typeof ticket !== 'string') return null;
  const [payload, signature] = ticket.split('.');
  if (!payload || !signature) return null;
  const expected = crypto
    .createHmac('sha256', sessionSecret)
    .update(payload)
    .digest('base64url');
  const receivedBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  if (
    receivedBytes.length !== expectedBytes.length
    || !crypto.timingSafeEqual(receivedBytes, expectedBytes)
  ) {
    return null;
  }
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (
      typeof decoded.requestId !== 'string'
      || !/^[0-9a-f-]{36}$/i.test(decoded.requestId)
      || typeof decoded.userId !== 'string'
      || !Number.isFinite(decoded.expiresAt)
      || Date.now() > decoded.expiresAt
    ) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

function testPythonExecutable() {
  const virtualEnvironmentPython = process.platform === 'win32'
    ? path.join(rootDir, '.venv-test', 'Scripts', 'python.exe')
    : path.join(rootDir, '.venv-test', 'bin', 'python');
  if (fs.existsSync(virtualEnvironmentPython)) return virtualEnvironmentPython;
  return process.platform === 'win32' ? 'python' : 'python3';
}

function localTestEnvironment(overrides = {}) {
  const allowedVariables = [
    'PATH',
    'HOME',
    'TMPDIR',
    'TEMP',
    'TMP',
    'SystemRoot',
    'WINDIR',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'PLAYWRIGHT_BROWSERS_PATH',
  ];
  const environment = {};
  for (const name of allowedVariables) {
    if (process.env[name]) environment[name] = process.env[name];
  }
  return {
    ...environment,
    PYTHONUNBUFFERED: '1',
    ...overrides,
  };
}

function terminateTestProcess(child) {
  if (!child || child.killed || child.exitCode !== null) return;
  try {
    if (process.platform !== 'win32' && child.pid) {
      process.kill(-child.pid, 'SIGTERM');
    } else {
      child.kill();
    }
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

function runTestCommand(run, label, command, args, env = {}) {
  const startedAt = Date.now();
  run.step = label;
  run.message = label;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      env: localTestEnvironment(env),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    const log = fs.createWriteStream(run.logPath, { flags: 'a' });
    let tail = '';
    let settled = false;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      terminateTestProcess(child);
    }, testRunCommandTimeoutMs);
    run.child = child;

    const capture = (chunk) => {
      log.write(chunk);
      tail = `${tail}${chunk.toString('utf8')}`.slice(-testRunMaxLogTailLength);
    };
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);

    child.once('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      run.child = null;
      log.end();
      reject(error);
    });

    child.once('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      run.child = null;
      log.end();
      const step = {
        name: label,
        exitCode: code === null ? 1 : code,
        durationMs: Date.now() - startedAt,
        timedOut,
        signal: signal || null,
        outputTail: tail,
      };
      run.steps.push(step);
      resolve(step);
    });
  });
}

function scheduleTestRunCleanup(run) {
  const cleanup = setTimeout(() => {
    testRuns.delete(run.requestId);
    fs.rm(run.outputDir, { recursive: true, force: true }, (error) => {
      if (error) console.error('Could not remove expired test-run files:', error.message);
    });
  }, testRunRetentionMs);
  cleanup.unref();
}

async function executeLocalWebsiteTestRun(run) {
  const python = testPythonExecutable();
  const frontendJunit = path.join(run.outputDir, 'frontend-junit.xml');
  const backendJunit = path.join(run.outputDir, 'backend-junit.xml');
  const frontendObservations = path.join(run.outputDir, 'frontend-observations.json');
  const backendObservations = path.join(run.outputDir, 'backend-observations.json');
  const testEnvironment = {
    TEST_RESULTS_DIR: run.outputDir,
  };
  const commands = [
    {
      label: 'Playwright: pruebas frontend',
      args: [
        '-m', 'pytest', '-q', '-m', 'frontend',
        `--junitxml=${frontendJunit}`,
      ],
      env: { ...testEnvironment, TEST_OBSERVATIONS_PATH: frontendObservations },
    },
    {
      label: 'pytest: contratos de APIs backend',
      args: [
        '-m', 'pytest', '-q', '-m', 'backend',
        `--junitxml=${backendJunit}`,
      ],
      env: { ...testEnvironment, TEST_OBSERVATIONS_PATH: backendObservations },
    },
    {
      label: 'Generando reporte PDF frontend/backend',
      args: [
        path.join(rootDir, 'tools', 'build-deployment-test-reports.py'),
        '--frontend-junit', frontendJunit,
        '--backend-junit', backendJunit,
        '--frontend-observations', frontendObservations,
        '--backend-observations', backendObservations,
        '--output-dir', run.outputDir,
      ],
      env: testEnvironment,
    },
  ];

  try {
    for (const command of commands) {
      const step = await runTestCommand(
        run,
        command.label,
        python,
        command.args,
        command.env,
      );
      if (step.timedOut) {
        run.error = `${command.label} excedió el tiempo máximo permitido.`;
      }
    }
  } catch (error) {
    run.error = `No se pudo ejecutar ${run.step}: ${error.message}`;
    console.error('Local website test runner failed:', error.message);
  } finally {
    run.finishedAt = nowIso();
    run.status = 'completed';
    run.conclusion = run.error || run.steps.some((step) => step.exitCode !== 0)
      ? 'failure'
      : 'success';
    run.reportPath = path.join(run.outputDir, 'pruebas-frontend-backend.pdf');
    run.reportAvailable = fs.existsSync(run.reportPath);
    run.step = '';
    run.message = run.conclusion === 'success'
      ? 'Las pruebas frontend y backend terminaron correctamente.'
      : run.reportAvailable
        ? 'Las pruebas terminaron con errores; el reporte está disponible.'
        : run.error || 'Las pruebas terminaron con errores y no se pudo generar el PDF.';
    if (activeTestRunId === run.requestId) activeTestRunId = null;
    scheduleTestRunCleanup(run);
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve({});
      }
    });
  });
}

function serveFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const type = mimeTypes[ext] || 'application/octet-stream';
  if (ext === '.apk') {
    fs.stat(filePath, (statError, stats) => {
      if (statError) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': type,
        'Content-Length': stats.size,
        'Content-Disposition': 'attachment; filename="BioMedica-Android.apk"',
        'Cache-Control': 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      });
      const apkStream = fs.createReadStream(filePath);
      apkStream.on('error', (error) => {
        console.error('Could not stream Android app download:', error.message);
        res.destroy(error);
      });
      apkStream.pipe(res);
    });
    return;
  }
  // El panel se puede insertar como iframe desde este mismo origen.
  const isFlutterAsset = filePath.includes('flutter-dashboard');
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const headers = {
      'Content-Type': type,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
      'Content-Security-Policy': "default-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.google.com https://www.gstatic.com data: blob:; img-src 'self' data: https:; frame-src 'self' https://www.google.com; connect-src 'self' http: https:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; font-src 'self' data: https:; worker-src 'self' blob:",
    };
    if (ext === '.apk') {
      headers['Content-Disposition'] = 'attachment; filename="BioMedica-Android.apk"';
    }
    if (!isFlutterAsset) {
      headers['X-Frame-Options'] = 'SAMEORIGIN';
    }
    res.writeHead(200, headers);
    res.end(data);
  });
}

function pickWearable(id) {
  return state.wearables.find((item) => item.id === id) || null;
}

function ensureWearable(wearableId, source, wearableFormFactor) {
  let wearable = state.wearables.find((item) => item.id === wearableId);
  if (!wearable) {
    wearable = createWearableRecord(wearableId, source, wearableFormFactor);
    state.wearables.unshift(wearable);
  }
  return wearable;
}

function getTelemetryForWearable(wearableId) {
  return state.telemetryByWearable[wearableId] || state.lastTelemetry;
}

function getTelemetryHistoryForWearable(wearableId) {
  const history = state.telemetryHistoryByWearable[wearableId] || [];
  if (history.length > maxTelemetryHistory) {
    const trimmed = history.slice(-maxTelemetryHistory);
    state.telemetryHistoryByWearable[wearableId] = trimmed;
    return trimmed;
  }
  return history;
}

function syncActiveTelemetry() {
  if (!state.activeWearableId) {
    state.lastTelemetry = { ...initialTelemetry };
    state.telemetryHistory = [];
    return;
  }
  const wearableHistory = getTelemetryHistoryForWearable(state.activeWearableId);
  state.lastTelemetry = { ...getTelemetryForWearable(state.activeWearableId) };
  state.telemetryHistory = wearableHistory.slice(-maxTelemetryHistory);
}

function getStatusSnapshot() {
  return {
    wearables: state.wearables,
    wearable: pickWearable(state.activeWearableId),
    tv: pickTv(state.activeTvId),
    tvs: state.tvs,
    activeWearableId: state.activeWearableId,
    tvPaired: state.tvPaired,
    lastTelemetry: state.lastTelemetry,
    telemetryHistory: state.telemetryHistory,
  };
}

function getCompactStatusSnapshot() {
  return {
    wearable: pickWearable(state.activeWearableId),
    tv: pickTv(state.activeTvId),
    activeWearableId: state.activeWearableId,
    tvPaired: state.tvPaired,
    lastTelemetry: state.lastTelemetry,
    telemetryHistory: state.telemetryHistory.slice(-20),
  };
}

function pickTv(id) {
  return state.tvs.find((item) => item.id === id) || state.tvs[0];
}

function getCurrentAppointment() {
  return state.appointments.find((item) => item.estado === 'en_atencion') || null;
}

function getQueueAppointments() {
  return state.appointments
    .filter((item) => item.estado !== 'finalizado')
    .sort((left, right) => left.codigo.localeCompare(right.codigo));
}

function requireAdmin(req, res, roles = []) {
  const token = extractBearerToken(req);
  const payload = verifyToken(token);
  if (!payload) {
    unauthorized(res, 'Sesión administrativa inválida o expirada');
    return null;
  }

  const user = state.adminUsers.find((item) => item.id === payload.sub && item.status === 'activo');
  if (!user) {
    unauthorized(res, 'Usuario administrativo no disponible');
    return null;
  }

  if (roles.length > 0 && !roles.includes(user.role)) {
    forbidden(res, 'No tienes permisos para esta operación');
    return null;
  }

  return user;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const { pathname } = url;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.end();
    return;
  }

  if (pathname === '/api/test-runs' && req.method === 'POST') {
    const userId = await authorizeTestRunnerAdmin(req, res);
    if (!userId) return;
    if (!sessionSecret) {
      sendJson(res, 503, {
        error: 'El servicio de pruebas temporales todavía no está habilitado.',
      });
      return;
    }

    if (activeTestRunId) {
      sendJson(res, 409, {
        error: 'Ya hay una ejecución completa de pruebas en curso. Inténtalo cuando termine.',
      });
      return;
    }

    const lastRunAt = testRunnerCooldowns.get(userId) || 0;
    const remainingCooldown = testRunnerCooldownMs - (Date.now() - lastRunAt);
    if (remainingCooldown > 0) {
      sendJson(res, 429, {
        error: `Espera ${Math.ceil(remainingCooldown / 1000)} segundos antes de iniciar otra ejecución.`,
      });
      return;
    }

    try {
      const requestId = crypto.randomUUID();
      const outputDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'biomedica-test-run-'));
      const run = {
        requestId,
        userId,
        outputDir,
        logPath: path.join(outputDir, 'runner.log'),
        status: 'in_progress',
        conclusion: null,
        step: 'Preparando la ejecución',
        message: 'Iniciando las pruebas Playwright y pytest en este servicio.',
        steps: [],
        startedAt: nowIso(),
        finishedAt: null,
        reportPath: null,
        reportAvailable: false,
        error: null,
        child: null,
      };
      testRuns.set(requestId, run);
      activeTestRunId = requestId;
      testRunnerCooldowns.set(userId, Date.now());
      const ticket = createTestRunTicket(requestId, userId);
      sendJson(res, 202, {
        requestId,
        ticket,
        status: run.status,
        message: run.message,
      });
      executeLocalWebsiteTestRun(run).catch((error) => {
        console.error('Local website test runner failed:', error.message);
        run.error = `No se pudo completar la ejecución: ${error.message}`;
        run.status = 'completed';
        run.conclusion = 'failure';
        run.finishedAt = nowIso();
        run.message = 'No se pudo completar la ejecución de pruebas.';
        if (activeTestRunId === requestId) activeTestRunId = null;
        scheduleTestRunCleanup(run);
      });
    } catch (error) {
      console.error('Could not create the local test run:', error.message);
      sendJson(res, 500, {
        error: 'No se pudo iniciar la ejecución completa de pruebas.',
      });
    }
    return;
  }

  const testRunMatch = pathname.match(/^\/api\/test-runs\/([^/]+)$/);
  if (testRunMatch && req.method === 'GET') {
    const userId = await authorizeTestRunnerAdmin(req, res);
    if (!userId) return;
    const ticket = testRunMatch[1];
    const decoded = verifyTestRunTicket(ticket);
    if (!decoded || decoded.userId !== userId) {
      sendJson(res, 404, { error: 'No se encontró esta ejecución de pruebas.' });
      return;
    }
    const run = testRuns.get(decoded.requestId);
    if (!run || run.userId !== userId) {
      sendJson(res, 404, { error: 'No se encontró esta ejecución de pruebas.' });
      return;
    }
    sendJson(res, 200, {
      requestId: run.requestId,
      status: run.status,
      conclusion: run.conclusion,
      step: run.step,
      message: run.message,
      error: run.error,
      reportAvailable: run.reportAvailable,
      steps: run.steps.map(({ name, exitCode, durationMs, timedOut }) => ({
        name,
        exitCode,
        durationMs,
        timedOut,
      })),
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    });
    return;
  }

  const testRunReportMatch = pathname.match(/^\/api\/test-runs\/([^/]+)\/report$/);
  if (testRunReportMatch && req.method === 'GET') {
    const userId = await authorizeTestRunnerAdmin(req, res);
    if (!userId) return;
    const ticket = testRunReportMatch[1];
    const decoded = verifyTestRunTicket(ticket);
    if (!decoded || decoded.userId !== userId) {
      sendJson(res, 404, { error: 'No se encontró esta ejecución de pruebas.' });
      return;
    }

    const run = testRuns.get(decoded.requestId);
    if (!run || run.userId !== userId) {
      sendJson(res, 404, { error: 'No se encontró esta ejecución de pruebas.' });
      return;
    }
    if (run.status !== 'completed') {
      sendJson(res, 409, { error: 'El reporte estará disponible cuando terminen las pruebas.' });
      return;
    }
    if (!run.reportAvailable || !run.reportPath || !fs.existsSync(run.reportPath)) {
      sendJson(res, 404, { error: 'No se pudo generar el reporte de pruebas.' });
      return;
    }
    let stat;
    try {
      stat = await fs.promises.stat(run.reportPath);
    } catch (error) {
      console.error('Could not inspect local test report:', error.message);
      sendJson(res, 404, { error: 'El reporte solicitado ya no está disponible.' });
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Length': stat.size,
      'Content-Disposition': 'attachment; filename="pruebas-frontend-backend.pdf"',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Access-Control-Allow-Origin': '*',
    });
    const report = fs.createReadStream(run.reportPath);
    report.on('error', (error) => {
      console.error('Could not read local test report:', error.message);
      res.destroy(error);
    });
    report.pipe(res);
    return;
  }

  if (pathname === '/config.json' && req.method === 'GET') {
    if (!supabaseUrl || !supabasePublishableKey) {
      sendJson(res, 503, { message: 'El portal web no tiene configurado Supabase.' });
      return;
    }
    sendJson(res, 200, {
      supabaseUrl,
      supabasePublishableKey,
    });
    return;
  }

  const reportReviewMatch = pathname.match(/^\/api\/core\/reports\/([^/]+)\/review$/);
  if (
    (pathname === '/api/core/reports' && req.method === 'GET')
    || (reportReviewMatch && req.method === 'PATCH')
  ) {
    const authorization = req.headers.authorization || '';
    if (!/^Bearer\s+\S+$/.test(authorization)) {
      unauthorized(res, 'Inicia sesión para consultar los reportes.');
      return;
    }
    try {
      const activeAccount = await isActiveSupabaseAccount(authorization);
      if (activeAccount === null) {
        unauthorized(res, 'La sesión de Supabase no es válida.');
        return;
      }
      if (!activeAccount) {
        forbidden(res, 'La cuenta está inactiva. Contacta al administrador.');
        return;
      }
    } catch (error) {
      console.error('Supabase account status check failed:', error.message);
      sendJson(res, 503, { message: 'No se pudo validar el estado de la cuenta.' });
      return;
    }
    if (!coreApiUrl) {
      sendJson(res, 503, { message: 'La API de reportes no está configurada.' });
      return;
    }
    try {
      const requestHeaders = { authorization };
      if (reportReviewMatch) requestHeaders['Content-Type'] = 'application/json';
      const upstream = await fetch(
        `${coreApiUrl.replace(/\/+$/, '')}/api/reports${
          reportReviewMatch ? `/${reportReviewMatch[1]}/review` : ''
        }`,
        {
          method: req.method,
          headers: requestHeaders,
          body: reportReviewMatch ? JSON.stringify(await readBody(req)) : undefined,
          signal: AbortSignal.timeout(10000),
        },
      );
      const body = await upstream.arrayBuffer();
      res.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(Buffer.from(body));
    } catch (error) {
      console.error('Report API proxy request failed:', error.message);
      sendJson(res, 502, { message: 'No se pudo conectar con el servicio de reportes.' });
    }
    return;
  }

  if (pathname === '/api/core/chat/notifications' && req.method === 'POST') {
    const authorization = req.headers.authorization || '';
    if (!/^Bearer\s+\S+$/.test(authorization)) {
      unauthorized(res, 'Inicia sesión para notificar mensajes.');
      return;
    }
    if (!coreApiUrl) {
      sendJson(res, 503, { message: 'La API de notificaciones no está configurada.' });
      return;
    }
    try {
      const payload = await readBody(req);
      const upstream = await fetch(
        `${coreApiUrl.replace(/\/+$/, '')}/api/chat/notifications`,
        {
          method: 'POST',
          headers: {
            authorization,
            'content-type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10000),
        },
      );
      const body = await upstream.arrayBuffer();
      res.writeHead(upstream.status, {
        'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      res.end(Buffer.from(body));
    } catch (error) {
      console.error('Chat notification proxy request failed:', error.message);
      sendJson(res, 502, { message: 'No se pudo conectar con el servicio de notificaciones.' });
    }
    return;
  }

  if (pathname.startsWith('/api/admin/')) {
    sendJson(res, 410, {
      error: 'La administración local fue retirada. Usa el portal autenticado con Supabase.',
    });
    return;
  }

  if (pathname === '/api/devices' && req.method === 'GET') {
    sendJson(res, 200, {
      wearables: state.wearables,
      tvs: state.tvs,
      activeWearableId: state.activeWearableId,
      activeTvId: state.activeTvId,
      tvPaired: state.tvPaired,
      lastTelemetry: getTelemetryForWearable(state.activeWearableId),
    });
    return;
  }

  if (pathname === '/api/status' && req.method === 'GET') {
    const compact = url.searchParams.get('compact') === '1';
    sendJson(res, 200, compact ? getCompactStatusSnapshot() : getStatusSnapshot());
    return;
  }

  if (pathname === '/api/tv/status' && req.method === 'GET') {
    sendJson(res, 200, {
      tvs: state.tvs,
      activeTvId: state.activeTvId,
      tvPaired: state.tvPaired,
      tv: pickTv(state.activeTvId),
    });
    return;
  }

  if (pathname === '/api/tv/pair' && req.method === 'POST') {
    const body = await readBody(req);
    const tvId = String(body.tvId || '').trim();
    const tv = state.tvs.find((item) => item.id === tvId);
    if (!tv) {
      sendJson(res, 404, { error: 'No se encontró la pantalla seleccionada.' });
      return;
    }

    state.activeTvId = tv.id;
    state.tvPaired = true;
    tv.estado = 'Emparejado';
    tv.appActiva = 'BioMedica TV Hub';
    sendJson(res, 200, { ok: true, activeTvId: tv.id, tvPaired: true, tv });
    return;
  }

  if (pathname === '/api/tv/unpair' && req.method === 'POST') {
    const body = await readBody(req);
    const tvId = String(body.tvId || state.activeTvId).trim();
    const tv = state.tvs.find((item) => item.id === tvId);
    if (!tv) {
      sendJson(res, 404, { error: 'No se encontró la pantalla seleccionada.' });
      return;
    }

    tv.estado = 'Disponible';
    if (state.activeTvId === tv.id) {
      state.tvPaired = false;
    }
    sendJson(res, 200, {
      ok: true,
      activeTvId: state.activeTvId,
      tvPaired: state.tvPaired,
      tv,
    });
    return;
  }

  if (pathname === '/api/telemetry/history' && req.method === 'GET') {
    const wearableId = url.searchParams.get('wearableId') || state.activeWearableId;
    sendJson(res, 200, {
      wearableId,
      points: getTelemetryHistoryForWearable(wearableId),
    });
    return;
  }

  if (pathname === '/api/tv-feed' && req.method === 'GET') {
    if (!supabaseUrl || !supabasePublishableKey) {
      sendJson(res, 503, { error: 'La cola de turnos compartida no está configurada.' });
      return;
    }
    try {
      const upstream = await fetch(
        `${supabaseUrl.replace(/\/+$/, '')}/rest/v1/rpc/public_clinic_turn_feed`,
        {
          headers: {
            apikey: supabasePublishableKey,
            authorization: `Bearer ${supabasePublishableKey}`,
          },
          signal: AbortSignal.timeout(10000),
        },
      );
      if (!upstream.ok) {
        console.error('Supabase public turn feed returned HTTP', upstream.status);
        sendJson(res, 502, { error: 'No se pudo consultar la cola compartida de turnos.' });
        return;
      }
      const queue = await upstream.json();
      sendJson(res, 200, {
        currentTurn: queue.find((turn) => turn.status === 'en_atencion') || null,
        queue: queue.filter((turn) => turn.status !== 'finalizado'),
        wearable: pickWearable(state.activeWearableId),
        tv: pickTv(state.activeTvId),
        lastTelemetry: state.lastTelemetry,
      });
    } catch (error) {
      console.error('Supabase public turn feed request failed:', error.message);
      sendJson(res, 502, { error: 'No se pudo conectar con la cola compartida de turnos.' });
    }
    return;
  }

  if (pathname === '/api/telemetry' && req.method === 'POST') {
    const body = await readBody(req);
    const wearableId = body.wearableId;
    if (!wearableId) {
      sendJson(res, 400, { error: 'wearableId is required' });
      return;
    }

    const wearableFormFactor = body.wearableFormFactor === 'round' || body.wearableFormFactor === 'square'
      ? body.wearableFormFactor
      : 'desconocido';
    const wearable = ensureWearable(wearableId, body.source, wearableFormFactor);
    const previousTelemetry = getTelemetryForWearable(wearableId);
    const nextTelemetry = createTelemetrySnapshot(wearableId, previousTelemetry, body);

    wearable.nombre = inferWearableName(wearableId, wearableFormFactor);
    wearable.modelo = wearableFormFactor === 'square'
      ? 'Emulador Wear OS cuadrado'
      : wearableFormFactor === 'round'
        ? 'Emulador Wear OS redondo'
        : wearable.modelo;
    wearable.ubicacion = wearableFormFactor === 'square'
      ? 'Sesion remota · reloj cuadrado'
      : wearableFormFactor === 'round'
        ? 'Sesion remota · reloj redondo'
        : wearable.ubicacion;

    state.telemetryByWearable[wearableId] = nextTelemetry;
    const history = getTelemetryHistoryForWearable(wearableId);
    history.push(nextTelemetry);
    if (history.length > maxTelemetryHistory) {
      history.splice(0, history.length - maxTelemetryHistory);
    }
    state.telemetryHistoryByWearable[wearableId] = history;

    wearable.ritmoCardiaco = nextTelemetry.heartRate;
    wearable.spo2 = nextTelemetry.spo2;
    wearable.temperatura = nextTelemetry.temperature;
    wearable.bateria = nextTelemetry.battery;
    wearable.estado = 'Conectado';
    wearable.steps = nextTelemetry.steps;
    wearable.stress = nextTelemetry.stress;
    wearable.respiratoryRate = nextTelemetry.respiratoryRate;
    wearable.hrv = nextTelemetry.hrv;
    wearable.signalQuality = nextTelemetry.signalQuality;

    if (!state.activeWearableId || !state.wearables.some((item) => item.id === state.activeWearableId)) {
      state.activeWearableId = wearableId;
    }

    if (state.activeWearableId === wearableId) {
      syncActiveTelemetry();
    }

    sendJson(res, 200, { ok: true, telemetry: nextTelemetry, wearable });
    return;
  }

  if (pathname === '/api/select-wearable' && req.method === 'POST') {
    const body = await readBody(req);
    const wearableId = String(body.wearableId || '').trim();
    if (!wearableId) {
      sendJson(res, 400, { error: 'wearableId is required' });
      return;
    }

    const wearable = pickWearable(wearableId);
    if (!wearable) {
      sendJson(res, 404, { error: 'Wearable no encontrado' });
      return;
    }

    state.activeWearableId = wearable.id;
    syncActiveTelemetry();
    sendJson(res, 200, {
      ok: true,
      wearable,
      lastTelemetry: state.lastTelemetry,
      message: `Wearable activo cambiado a ${wearable.nombre}`,
    });
    return;
  }

  if (pathname === '/api/pair' && req.method === 'POST') {
    const body = await readBody(req);
    const wearableId = String(body.wearableId || '').trim();
    const tvId = String(body.tvId || '').trim();
    if (!wearableId || !tvId) {
      sendJson(res, 400, { error: 'wearableId and tvId are required' });
      return;
    }
    const tv = state.tvs.find((item) => item.id === tvId);
    if (!tv) {
      sendJson(res, 404, { error: 'Screen not found' });
      return;
    }
    const wearable = ensureWearable(wearableId, body.source, body.wearableFormFactor);
    state.activeWearableId = wearable.id;
    state.activeTvId = tv.id;
    state.tvPaired = true;
    syncActiveTelemetry();
    tv.estado = 'Emparejado';
    tv.appActiva = 'BioMedica TV Hub';
    sendJson(res, 200, {
      ok: true,
      wearable,
      tv,
      message: `Conectado: ${wearable.nombre} -> ${tv.nombre}`,
    });
    return;
  }

  if (pathname === '/api/admin/login' && req.method === 'POST') {
    const body = await readBody(req);
    const username = String(body.username || '').trim();
    const password = String(body.password || '');
    const user = state.adminUsers.find((item) => item.username === username);

    if (!user || user.passwordHash !== hashPassword(password)) {
      unauthorized(res, 'Credenciales incorrectas');
      return;
    }

    if (user.status !== 'activo') {
      forbidden(res, 'Usuario bloqueado');
      return;
    }

    user.lastLoginAt = nowIso();
    const token = generateToken(user);
    sendJson(res, 200, {
      token,
      session: {
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        expiresAt: new Date(Date.now() + sessionTtlMs).toISOString(),
      },
      message: 'Acceso administrativo concedido con política de sesión temporal.',
    });
    return;
  }

  if (pathname === '/api/admin/session' && req.method === 'GET') {
    const user = requireAdmin(req, res);
    if (!user) {
      return;
    }

    const payload = verifyToken(extractBearerToken(req));
    sendJson(res, 200, {
      session: {
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        expiresAt: new Date(payload.expiresAtMs).toISOString(),
      },
    });
    return;
  }

  if (pathname === '/api/admin/users' && req.method === 'GET') {
    const user = requireAdmin(req, res);
    if (!user) {
      return;
    }

    sendJson(res, 200, { users: state.adminUsers.map(sanitizeUser) });
    return;
  }

  if (pathname === '/api/admin/users' && req.method === 'POST') {
    const user = requireAdmin(req, res, ['superadmin']);
    if (!user) {
      return;
    }

    const body = await readBody(req);
    const username = String(body.username || '').trim();
    const displayName = String(body.displayName || '').trim();
    const password = String(body.password || '');
    const role = ['superadmin', 'operador', 'visor'].includes(body.role) ? body.role : 'visor';

    if (!username || !displayName) {
      sendJson(res, 400, { error: 'Nombre y usuario son obligatorios' });
      return;
    }

    if (!validatePasswordStrength(password)) {
      sendJson(res, 400, { error: 'La contraseña debe tener 8+ caracteres, mayúscula, minúscula, número y símbolo' });
      return;
    }

    if (state.adminUsers.some((item) => item.username === username)) {
      sendJson(res, 409, { error: 'El usuario ya existe' });
      return;
    }

    state.adminUsers.push({
      id: `admin-${crypto.randomUUID()}`,
      username,
      displayName,
      role,
      status: 'activo',
      passwordHash: hashPassword(password),
      createdAt: nowIso(),
      lastLoginAt: null,
    });
    sendJson(res, 201, { message: 'Usuario administrativo creado' });
    return;
  }

  if (pathname.startsWith('/api/admin/users/') && req.method === 'PATCH') {
    const user = requireAdmin(req, res, ['superadmin']);
    if (!user) {
      return;
    }

    const userId = pathname.split('/').pop();
    const target = state.adminUsers.find((item) => item.id === userId);
    if (!target) {
      sendJson(res, 404, { error: 'Usuario no encontrado' });
      return;
    }

    const body = await readBody(req);
    if (body.status && ['activo', 'bloqueado'].includes(body.status)) {
      target.status = body.status;
    }
    sendJson(res, 200, { message: 'Usuario actualizado', user: sanitizeUser(target) });
    return;
  }

  if (pathname === '/api/admin/appointments' && req.method === 'GET') {
    const user = requireAdmin(req, res);
    if (!user) {
      return;
    }

    sendJson(res, 200, { appointments: state.appointments });
    return;
  }

  if (pathname === '/api/admin/appointments' && req.method === 'POST') {
    const user = requireAdmin(req, res, ['superadmin', 'operador']);
    if (!user) {
      return;
    }

    const body = await readBody(req);
    const codigo = String(body.codigo || '').trim();
    const paciente = String(body.paciente || '').trim();
    if (!codigo || !paciente) {
      sendJson(res, 400, { error: 'Código y paciente son obligatorios' });
      return;
    }

    state.appointments.push({
      id: `turno-${crypto.randomUUID()}`,
      codigo,
      paciente,
      servicio: String(body.servicio || 'Telemetria').trim(),
      sala: String(body.sala || 'Modulo A').trim(),
      prioridad: ['alta', 'media', 'baja'].includes(body.prioridad) ? body.prioridad : 'media',
      estado: 'en_espera',
      etaMin: Number(body.etaMin) || 0,
      updatedAt: nowIso(),
    });
    sendJson(res, 201, { message: 'Turno agregado correctamente' });
    return;
  }

  if (pathname.startsWith('/api/admin/appointments/') && req.method === 'PATCH') {
    const user = requireAdmin(req, res, ['superadmin', 'operador']);
    if (!user) {
      return;
    }

    const appointmentId = pathname.split('/').pop();
    const target = state.appointments.find((item) => item.id === appointmentId);
    if (!target) {
      sendJson(res, 404, { error: 'Turno no encontrado' });
      return;
    }

    const body = await readBody(req);
    if (body.estado && ['en_espera', 'en_atencion', 'finalizado'].includes(body.estado)) {
      if (body.estado === 'en_atencion') {
        state.appointments.forEach((item) => {
          if (item.id !== target.id && item.estado === 'en_atencion') {
            item.estado = 'en_espera';
            item.updatedAt = nowIso();
          }
        });
      }
      target.estado = body.estado;
    }
    target.updatedAt = nowIso();
    sendJson(res, 200, { message: 'Turno actualizado', appointment: target });
    return;
  }

  if (pathname === '/api/unpair' && req.method === 'POST') {
    const tv = pickTv(state.activeTvId);
    tv.estado = 'Disponible';
    tv.appActiva = 'BioMedica TV Hub';
    state.tvPaired = false;
    sendJson(res, 200, { ok: true, message: 'Dispositivos desconectados' });
    return;
  }

  const staticCandidates = [
    path.join(publicRootDir, pathname),
    path.join(distDir, pathname),
    path.join(publicBiomedicaDir, pathname.replace('/biomedica', '')),
    path.join(assetsDir, pathname.replace('/assets', '')),
  ];

  for (const candidate of staticCandidates) {
    if (candidate.includes('..')) {
      continue;
    }
    try {
      const stats = fs.statSync(candidate);
      if (stats.isFile()) {
        serveFile(res, candidate);
        return;
      }
    } catch {
      // continue
    }
  }

  const indexFile = path.join(distDir, 'index.html');
  if (fs.existsSync(indexFile)) {
    serveFile(res, indexFile);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Build the Angular app first with npm run build.');
});

server.listen(port, () => {
  console.log(`BioMedica bridge running at http://localhost:${port}`);
  console.log(`Admin demo user: ${adminUsername}`);
});
