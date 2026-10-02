import 'dotenv/config';
import express from 'express';
import compression from 'compression';
import http from 'http';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import mongoose from 'mongoose';
import { WebSocketServer, WebSocket } from 'ws';
import { GoogleGenAI, LiveServerMessage, Modality, Type, type FunctionDeclaration, type FunctionResponse } from '@google/genai';

// Tolère des guillemets résiduels (ex. docker --env-file avec un .env entre guillemets)
for (const [key, value] of Object.entries(process.env)) {
  const match = value?.match(/^(["'])(.*)\1$/s);
  if (match) process.env[key] = match[2];
}

const PORT = Number(process.env.PORT) || 3000;
const MONGODB_DB = process.env.MONGODB_DB || 'cadence';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours
const MONGO_RETRY_MS = 15000;

// --- MongoDB Schemas & Models (Mongoose) ---
const userSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    passwordHash: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { collection: 'users' }
);

const userStateSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    tasks: { type: Array, default: [] },
    sessions: { type: Array, default: [] },
    settings: { type: Object, default: {} },
    // Projets, routines, notes « Vide-Esprit » et planning de la journée
    workspace: { type: Object, default: {} },
    revision: { type: Number, default: 0 },
    lastClientId: { type: String, default: null },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: 'user_states', minimize: false }
);

// Jetons de session : seul le hash SHA-256 du jeton est stocké, expiration automatique (index TTL)
const authSessionSchema = new mongoose.Schema(
  {
    tokenHash: { type: String, required: true, unique: true, index: true },
    userId: { type: String, required: true, index: true },
    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true, expires: 0 },
  },
  { collection: 'auth_sessions' }
);

const UserModel = mongoose.models.User || mongoose.model('User', userSchema);
const UserStateModel =
  mongoose.models.UserState || mongoose.model('UserState', userStateSchema);
const AuthSessionModel =
  mongoose.models.AuthSession || mongoose.model('AuthSession', authSessionSchema);

interface UserState {
  tasks: unknown[];
  sessions: unknown[];
  settings: Record<string, unknown>;
  workspace: Record<string, unknown>;
}

interface PublicUser {
  userId: string;
  email: string;
  name: string;
}

// --- Local Document Store Fallback when MONGODB_URI is not configured ---
const DATA_DIR = path.resolve(process.cwd(), 'data');
const FALLBACK_FILE = path.join(DATA_DIR, 'mongo_documents.json');

interface FallbackDatabase {
  users: Array<PublicUser & { passwordHash: string; createdAt: string }>;
  userStates: Record<
    string,
    UserState & { userId: string; revision?: number; updatedAt: string }
  >;
  sessionsTokens: Record<string, string>; // token -> userId
}

function readFallbackDb(): FallbackDatabase {
  try {
    if (!fs.existsSync(FALLBACK_FILE)) {
      return { users: [], userStates: {}, sessionsTokens: {} };
    }
    return JSON.parse(fs.readFileSync(FALLBACK_FILE, 'utf-8')) as FallbackDatabase;
  } catch {
    return { users: [], userStates: {}, sessionsTokens: {} };
  }
}

function writeFallbackDb(db: FallbackDatabase): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(FALLBACK_FILE, JSON.stringify(db, null, 2), 'utf-8');
  } catch (err) {
    console.error('Error writing fallback document store:', err);
  }
}

// --- MongoDB connection (live) ---
const MONGO_URI = (process.env.MONGODB_URI || '').trim();
// Quand une URI est configurée, MongoDB est la seule source de vérité : pas de repli
// silencieux sur le fichier local (sinon les données divergent entre les deux).
const useMongo = Boolean(MONGO_URI) && MONGO_URI !== 'MY_MONGODB_URI';
let isMongoConnected = false;
let mongoStatusMessage = useMongo
  ? 'Connexion au cluster MongoDB en cours…'
  : 'Base documentaire locale active (ajoutez MONGODB_URI dans .env pour MongoDB Atlas)';
let changeStream: mongoose.mongo.ChangeStream | null = null;

function getDbStatus() {
  return {
    connectedToMongoCluster: isMongoConnected,
    engine: useMongo ? `MongoDB Atlas (${MONGODB_DB})` : 'MongoDB Document Store (Local)',
    message: mongoStatusMessage,
    hasEnvUri: useMongo,
    live: useMongo ? isMongoConnected && changeStream !== null : true,
    signupCodeRequired: Boolean(SIGNUP_CODE),
  };
}

function setMongoStatus(connected: boolean, message: string) {
  const changed = connected !== isMongoConnected || message !== mongoStatusMessage;
  isMongoConnected = connected;
  mongoStatusMessage = message;
  if (changed) broadcastAll('db', getDbStatus());
}

function startChangeStream() {
  if (changeStream) return;
  try {
    changeStream = UserStateModel.watch([], { fullDocument: 'updateLookup' });
    changeStream.on('change', (change: any) => {
      const doc = change.fullDocument;
      if (!doc?.userId) return;
      broadcastState(doc.userId, {
        state: {
          tasks: doc.tasks || [],
          sessions: doc.sessions || [],
          settings: doc.settings || {},
          workspace: doc.workspace || {},
        },
        revision: doc.revision || 0,
        originClientId: doc.lastClientId || null,
        updatedAt: formatTime(doc.updatedAt),
      });
    });
    changeStream.on('error', (err: Error) => {
      console.error('MongoDB change stream error:', err.message);
      changeStream?.close().catch(() => {});
      changeStream = null;
      broadcastAll('db', getDbStatus());
      setTimeout(() => {
        if (isMongoConnected) startChangeStream();
      }, MONGO_RETRY_MS);
    });
  } catch (err) {
    console.error('Unable to open MongoDB change stream:', err);
    changeStream = null;
  }
}

async function connectMongo(): Promise<void> {
  if (!useMongo) return;

  mongoose.connection.on('connected', () => {
    setMongoStatus(true, `Connecté en direct au cluster MongoDB (base « ${MONGODB_DB} »)`);
    startChangeStream();
  });
  mongoose.connection.on('disconnected', () => {
    changeStream = null;
    setMongoStatus(false, 'Connexion MongoDB perdue — reconnexion automatique en cours…');
  });

  const attempt = async () => {
    try {
      await mongoose.connect(MONGO_URI, {
        dbName: MONGODB_DB,
        serverSelectionTimeoutMS: 8000,
      });
      await Promise.all([
        UserModel.init(),
        UserStateModel.init(),
        AuthSessionModel.init(),
        BlockerStateModel.init(),
      ]);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erreur de connexion';
      setMongoStatus(false, `MongoDB non joignable (${message}) — nouvel essai dans ${MONGO_RETRY_MS / 1000}s`);
      console.error('MongoDB connection failed:', message);
      setTimeout(attempt, MONGO_RETRY_MS);
    }
  };
  await attempt();
}

function ensureDbAvailable(res: express.Response): boolean {
  if (useMongo && !isMongoConnected) {
    res.status(503).json({ error: 'Base de données momentanément indisponible, nouvel essai automatique.' });
    return false;
  }
  return true;
}

// --- Passwords (scrypt, sel unique par utilisateur) ---
function legacyHashPassword(password: string): string {
  return crypto.createHash('sha256').update(`cadence_salt_${password}`).digest('hex');
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password: string, stored: string): { ok: boolean; needsRehash: boolean } {
  if (stored.startsWith('scrypt$')) {
    const [, salt, hash] = stored.split('$');
    const expected = Buffer.from(hash, 'hex');
    const actual = crypto.scryptSync(password, salt, expected.length);
    return { ok: crypto.timingSafeEqual(expected, actual), needsRehash: false };
  }
  // Ancien format (sha256 à sel fixe) : accepté une fois puis migré vers scrypt
  const ok = legacyHashPassword(password) === stored;
  return { ok, needsRehash: ok };
}

// --- Auth sessions ---
function generateToken(): string {
  return crypto.randomBytes(24).toString('hex');
}

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

const tokenCache = new Map<string, { userId: string; expiresAt: number }>();

async function createSession(userId: string): Promise<string> {
  const token = generateToken();
  const expiresAt = Date.now() + SESSION_TTL_MS;
  if (useMongo) {
    await AuthSessionModel.create({
      tokenHash: hashToken(token),
      userId,
      expiresAt: new Date(expiresAt),
    });
  } else {
    const db = readFallbackDb();
    db.sessionsTokens[token] = userId;
    writeFallbackDb(db);
  }
  tokenCache.set(token, { userId, expiresAt });
  return token;
}

async function destroySession(token: string): Promise<void> {
  tokenCache.delete(token);
  if (useMongo) {
    await AuthSessionModel.deleteOne({ tokenHash: hashToken(token) });
  } else {
    const db = readFallbackDb();
    delete db.sessionsTokens[token];
    writeFallbackDb(db);
  }
}

function extractToken(req: express.Request): string | null {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7).trim() || null;
  // EventSource ne permet pas d'en-têtes personnalisés : jeton passé en query pour /stream
  const q = req.query.token;
  return typeof q === 'string' && q ? q : null;
}

async function resolveUserId(token: string | null): Promise<string | null> {
  if (!token) return null;
  const cached = tokenCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.userId;

  if (useMongo) {
    const doc = (await AuthSessionModel.findOne({
      tokenHash: hashToken(token),
      expiresAt: { $gt: new Date() },
    }).lean()) as { userId: string; expiresAt: Date } | null;
    if (!doc) return null;
    tokenCache.set(token, { userId: doc.userId, expiresAt: new Date(doc.expiresAt).getTime() });
    return doc.userId;
  }
  const userId = readFallbackDb().sessionsTokens[token];
  if (!userId) return null;
  tokenCache.set(token, { userId, expiresAt: Date.now() + SESSION_TTL_MS });
  return userId;
}

// --- User data access (Mongo ou fichier local) ---
function sanitizeState(input: Partial<UserState> | undefined): UserState {
  return {
    tasks: Array.isArray(input?.tasks) ? input!.tasks : [],
    sessions: Array.isArray(input?.sessions) ? input!.sessions : [],
    settings:
      input?.settings && typeof input.settings === 'object' && !Array.isArray(input.settings)
        ? input.settings
        : {},
    workspace:
      input?.workspace && typeof input.workspace === 'object' && !Array.isArray(input.workspace)
        ? input.workspace
        : {},
  };
}

function formatTime(date: Date | string | undefined): string {
  return new Date(date || Date.now()).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

async function findUserByEmail(
  email: string
): Promise<(PublicUser & { passwordHash: string }) | null> {
  if (useMongo) {
    return (await UserModel.findOne({ email }).lean()) as
      | (PublicUser & { passwordHash: string })
      | null;
  }
  return readFallbackDb().users.find((u) => u.email === email) || null;
}

async function updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
  if (useMongo) {
    await UserModel.updateOne({ userId }, { $set: { passwordHash } });
  } else {
    const db = readFallbackDb();
    const user = db.users.find((u) => u.userId === userId);
    if (user) user.passwordHash = passwordHash;
    writeFallbackDb(db);
  }
}

async function loadUserWithState(
  userId: string
): Promise<{ user: PublicUser; state: UserState; revision: number } | null> {
  if (useMongo) {
    const userDoc = (await UserModel.findOne({ userId }).lean()) as PublicUser | null;
    if (!userDoc) return null;
    const stateDoc = (await UserStateModel.findOne({ userId }).lean()) as
      | (Partial<UserState> & { revision?: number })
      | null;
    return {
      user: { userId: userDoc.userId, email: userDoc.email, name: userDoc.name },
      state: sanitizeState(stateDoc || undefined),
      revision: stateDoc?.revision || 0,
    };
  }
  const db = readFallbackDb();
  const user = db.users.find((u) => u.userId === userId);
  if (!user) return null;
  const st = db.userStates[userId];
  return {
    user: { userId: user.userId, email: user.email, name: user.name },
    state: sanitizeState(st),
    revision: st?.revision || 0,
  };
}

async function saveUserState(
  userId: string,
  state: UserState,
  clientId: string | null
): Promise<{ revision: number; updatedAt: Date }> {
  const updatedAt = new Date();
  if (useMongo) {
    const doc = (await UserStateModel.findOneAndUpdate(
      { userId },
      { $set: { ...state, lastClientId: clientId, updatedAt }, $inc: { revision: 1 } },
      { upsert: true, returnDocument: 'after' }
    ).lean()) as { revision: number } | null;
    return { revision: doc?.revision || 0, updatedAt };
  }
  const db = readFallbackDb();
  const revision = (db.userStates[userId]?.revision || 0) + 1;
  db.userStates[userId] = { userId, ...state, revision, updatedAt: updatedAt.toISOString() };
  writeFallbackDb(db);
  return { revision, updatedAt };
}

// --- Live hub (Server-Sent Events) ---
const liveClients = new Map<string, Set<express.Response>>();

function sendEvent(res: express.Response, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function broadcastState(userId: string, payload: unknown) {
  const clients = liveClients.get(userId);
  if (!clients) return;
  for (const res of clients) sendEvent(res, 'state', payload);
}

function broadcastAll(event: string, data: unknown) {
  for (const clients of liveClients.values()) {
    for (const res of clients) sendEvent(res, event, data);
  }
}

// --- Bouclier anti-distraction : un état par utilisateur (extension navigateur liée au compte) ---
const BLOCKER_FILE = path.join(DATA_DIR, 'blocker_states.json');
const EXTENSION_TIMEOUT_MS = 20000;

const blockerStateSchema = new mongoose.Schema(
  {
    userId: { type: String, required: true, unique: true, index: true },
    active: { type: Boolean, default: false },
    domains: { type: [String], default: [] },
    endsAt: { type: Number, default: null },
    attempts: { type: Number, default: 0 },
    lastAttempt: { type: Object, default: null },
    updatedAt: { type: Date, default: Date.now },
  },
  { collection: 'blocker_states' }
);
const BlockerStateModel =
  mongoose.models.BlockerState || mongoose.model('BlockerState', blockerStateSchema);

interface BlockerData {
  active: boolean;
  domains: string[];
  endsAt: number | null;
  attempts: number;
  lastAttempt: { domain: string; at: number } | null;
}

const blockerCache = new Map<string, BlockerData>();
const extensionSeenAt = new Map<string, number>();

function readBlockerFile(): Record<string, BlockerData> {
  try {
    return JSON.parse(fs.readFileSync(BLOCKER_FILE, 'utf-8'));
  } catch {
    return {};
  }
}

async function loadBlocker(userId: string): Promise<BlockerData> {
  const cached = blockerCache.get(userId);
  if (cached) return cached;
  const empty: BlockerData = { active: false, domains: [], endsAt: null, attempts: 0, lastAttempt: null };
  let stored: Partial<BlockerData> | null = null;
  if (useMongo) {
    stored = (await BlockerStateModel.findOne({ userId }).lean()) as Partial<BlockerData> | null;
  } else {
    stored = readBlockerFile()[userId] || null;
  }
  const data: BlockerData = {
    active: Boolean(stored?.active),
    domains: stored?.domains || empty.domains,
    endsAt: stored?.endsAt ?? null,
    attempts: stored?.attempts || 0,
    lastAttempt: stored?.lastAttempt || null,
  };
  blockerCache.set(userId, data);
  return data;
}

async function saveBlocker(userId: string, data: BlockerData): Promise<void> {
  blockerCache.set(userId, data);
  if (useMongo) {
    await BlockerStateModel.updateOne(
      { userId },
      { $set: { ...data, updatedAt: new Date() } },
      { upsert: true }
    );
  } else {
    const all = readBlockerFile();
    all[userId] = data;
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(BLOCKER_FILE, JSON.stringify(all), 'utf-8');
  }
}

function normalizeDomains(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const clean = input
    .filter((d): d is string => typeof d === 'string')
    .map((d) =>
      d
        .trim()
        .toLowerCase()
        .replace(/^[a-z]+:\/\//, '')
        .replace(/^www\./, '')
        .split(/[/?#:]/)[0]
    )
    .filter((d) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d));
  return [...new Set(clean)].slice(0, 200);
}

function blockerView(userId: string, data: BlockerData) {
  const now = Date.now();
  // La session reste verrouillée jusqu'à son terme, même si l'onglet Kronova est fermé
  const active = data.active && data.endsAt !== null && data.endsAt > now;
  return {
    active,
    domains: data.domains,
    endsAt: active ? data.endsAt : null,
    attempts: data.attempts,
    lastAttempt: data.lastAttempt,
    extensionConnected: now - (extensionSeenAt.get(userId) || 0) < EXTENSION_TIMEOUT_MS,
    serverTime: now,
  };
}

// --- Protection contre le bruteforce des connexions / inscriptions ---
const AUTH_WINDOW_MS = 15 * 60 * 1000;
const AUTH_MAX_ATTEMPTS = 10;
const authAttempts = new Map<string, { count: number; resetAt: number }>();

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const entry = authAttempts.get(key);
  if (!entry || entry.resetAt < now) {
    authAttempts.set(key, { count: 1, resetAt: now + AUTH_WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > AUTH_MAX_ATTEMPTS;
}

// --- Inscriptions : code d'invitation et/ou domaines e-mail autorisés (optionnels) ---
const SIGNUP_CODE = (process.env.SIGNUP_CODE || '').trim();
const ALLOWED_EMAIL_DOMAINS = (process.env.ALLOWED_EMAIL_DOMAINS || '')
  .split(',')
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

async function startServer() {
  await connectMongo();

  const app = express();
  // Derrière un reverse proxy (Caddy en production) : vraie IP client pour la limitation
  if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);
  // Compression gzip (le flux /api/user/stream déclare no-transform et n'est pas compressé)
  app.use(compression());
  app.use(express.json({ limit: '2mb' }));

  // Wrap async handlers so DB errors return 500 instead of crashing
  const handle =
    (label: string, fn: (req: express.Request, res: express.Response) => Promise<void>) =>
    (req: express.Request, res: express.Response) => {
      fn(req, res).catch((err) => {
        console.error(`${label} error:`, err);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Erreur de la base de données MongoDB.' });
        }
      });
    };

  // 1. Database status
  app.get('/api/db/status', (_req, res) => {
    res.json(getDbStatus());
  });

  // Configuration publique du client (intégrations optionnelles)
  app.get('/api/config', (_req, res) => {
    res.json({ googleClientId: process.env.GOOGLE_CLIENT_ID || null });
  });

  // Sonde de santé (Docker HEALTHCHECK / vérification du déploiement)
  app.get('/api/health', (_req, res) => {
    const ok = !useMongo || isMongoConnected;
    res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'degraded', database: getDbStatus().engine });
  });

  // 2. Auth: Register new user
  app.post(
    '/api/auth/register',
    handle('Register', async (req, res) => {
      if (!ensureDbAvailable(res)) return;
      const { email, name, password, initialState } = req.body as {
        email?: string;
        name?: string;
        password?: string;
        initialState?: Partial<UserState>;
      };

      if (!email || !password || !name) {
        res.status(400).json({ error: 'Veuillez renseigner votre nom, e-mail et mot de passe.' });
        return;
      }
      if (isRateLimited(`register:${req.ip}`)) {
        res.status(429).json({ error: 'Trop de tentatives, réessayez dans quelques minutes.' });
        return;
      }
      if (SIGNUP_CODE && req.body.inviteCode !== SIGNUP_CODE) {
        res.status(403).json({ error: 'Code d’invitation invalide.' });
        return;
      }
      if (password.length < 8) {
        res.status(400).json({ error: 'Le mot de passe doit contenir au moins 8 caractères.' });
        return;
      }

      const cleanEmail = email.trim().toLowerCase();
      const cleanName = name.trim();
      if (
        ALLOWED_EMAIL_DOMAINS.length > 0 &&
        !ALLOWED_EMAIL_DOMAINS.includes(cleanEmail.split('@')[1] || '')
      ) {
        res.status(403).json({ error: 'Les inscriptions sont réservées aux adresses de l’équipe.' });
        return;
      }
      if (await findUserByEmail(cleanEmail)) {
        res.status(409).json({ error: 'Un compte existe déjà avec cette adresse e-mail.' });
        return;
      }

      const passwordHash = hashPassword(password);
      const userId = `usr_${crypto.randomBytes(8).toString('hex')}`;
      const state = sanitizeState(initialState);

      if (useMongo) {
        await UserModel.create({ userId, email: cleanEmail, name: cleanName, passwordHash });
        await UserStateModel.create({ userId, ...state, revision: 1 });
      } else {
        const db = readFallbackDb();
        db.users.push({
          userId,
          email: cleanEmail,
          name: cleanName,
          passwordHash,
          createdAt: new Date().toISOString(),
        });
        db.userStates[userId] = { userId, ...state, revision: 1, updatedAt: new Date().toISOString() };
        writeFallbackDb(db);
      }

      const token = await createSession(userId);
      res.json({
        token,
        user: { userId, email: cleanEmail, name: cleanName },
        state,
        revision: 1,
      });
    })
  );

  // 3. Auth: Login existing user
  app.post(
    '/api/auth/login',
    handle('Login', async (req, res) => {
      if (!ensureDbAvailable(res)) return;
      const { email, password } = req.body as { email?: string; password?: string };
      if (!email || !password) {
        res.status(400).json({ error: 'Veuillez saisir votre e-mail et votre mot de passe.' });
        return;
      }

      const loginKey = `login:${req.ip}:${email.trim().toLowerCase()}`;
      if (isRateLimited(loginKey)) {
        res.status(429).json({ error: 'Trop de tentatives, réessayez dans quelques minutes.' });
        return;
      }
      const user = await findUserByEmail(email.trim().toLowerCase());
      const check = user ? verifyPassword(password, user.passwordHash) : { ok: false, needsRehash: false };
      if (!user || !check.ok) {
        res.status(401).json({ error: 'Identifiants incorrects.' });
        return;
      }
      authAttempts.delete(loginKey);
      if (check.needsRehash) {
        await updatePasswordHash(user.userId, hashPassword(password));
      }

      const data = await loadUserWithState(user.userId);
      const token = await createSession(user.userId);
      res.json({ token, ...data });
    })
  );

  // 4. Auth: Logout (révoque le jeton côté serveur)
  app.post(
    '/api/auth/logout',
    handle('Logout', async (req, res) => {
      const token = extractToken(req);
      if (token) await destroySession(token);
      res.json({ loggedOut: true });
    })
  );

  // 5. Get current authenticated user & state
  app.get(
    '/api/user/state',
    handle('Fetch state', async (req, res) => {
      if (!ensureDbAvailable(res)) return;
      const userId = await resolveUserId(extractToken(req));
      if (!userId) {
        res.status(401).json({ error: 'Session non authentifiée.' });
        return;
      }
      const data = await loadUserWithState(userId);
      if (!data) {
        res.status(404).json({ error: 'Utilisateur introuvable.' });
        return;
      }
      res.json(data);
    })
  );

  // 6. Save user tasks, sessions & settings (diffusé en direct aux autres appareils)
  app.put(
    '/api/user/state',
    handle('Save state', async (req, res) => {
      if (!ensureDbAvailable(res)) return;
      const userId = await resolveUserId(extractToken(req));
      if (!userId) {
        res.status(401).json({ error: 'Session non authentifiée.' });
        return;
      }

      const body = req.body as Partial<UserState> & { clientId?: string };
      const state = sanitizeState(body);
      const clientId = typeof body.clientId === 'string' ? body.clientId : null;
      const { revision, updatedAt } = await saveUserState(userId, state, clientId);

      // Sans change stream (fichier local ou flux indisponible), on diffuse directement
      if (!changeStream) {
        broadcastState(userId, {
          state,
          revision,
          originClientId: clientId,
          updatedAt: formatTime(updatedAt),
        });
      }

      res.json({ saved: true, revision, updatedAt: formatTime(updatedAt) });
    })
  );

  // 7. Live stream : pousse en temps réel les changements de la base à tous les appareils connectés
  app.get(
    '/api/user/stream',
    handle('Live stream', async (req, res) => {
      res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders();
      res.write('retry: 3000\n\n');

      sendEvent(res, 'db', getDbStatus());
      const userId = useMongo && !isMongoConnected ? null : await resolveUserId(extractToken(req));
      if (!userId) {
        // Base indisponible : on laisse le navigateur se reconnecter ; jeton invalide : on le signale
        if (!useMongo || isMongoConnected) sendEvent(res, 'unauthorized', {});
        res.end();
        return;
      }

      const data = await loadUserWithState(userId);
      if (data) {
        sendEvent(res, 'state', {
          user: data.user,
          state: data.state,
          revision: data.revision,
          originClientId: null,
          snapshot: true,
        });
      }

      let clients = liveClients.get(userId);
      if (!clients) {
        clients = new Set();
        liveClients.set(userId, clients);
      }
      clients.add(res);

      const heartbeat = setInterval(() => res.write(': ping\n\n'), 25000);
      req.on('close', () => {
        clearInterval(heartbeat);
        clients!.delete(res);
        if (clients!.size === 0) liveClients.delete(userId);
      });
    })
  );

  // 8. Bouclier anti-distraction : chaque utilisateur publie sa session ; son extension
  // navigateur (authentifiée avec le même compte) interroge ce point d'accès.
  const requireUser = async (req: express.Request, res: express.Response) => {
    if (!ensureDbAvailable(res)) return null;
    const userId = await resolveUserId(extractToken(req));
    if (!userId) res.status(401).json({ error: 'Session non authentifiée.' });
    return userId;
  };

  app.get(
    '/api/blocker/state',
    handle('Blocker state', async (req, res) => {
      const userId = await requireUser(req, res);
      if (!userId) return;
      if (req.get('X-Kronova-Client') === 'extension') extensionSeenAt.set(userId, Date.now());
      res.json(blockerView(userId, await loadBlocker(userId)));
    })
  );

  app.put(
    '/api/blocker/state',
    handle('Blocker update', async (req, res) => {
      const userId = await requireUser(req, res);
      if (!userId) return;
      const { active, domains, endsAt } = req.body as {
        active?: boolean;
        domains?: unknown;
        endsAt?: number;
      };
      const data = await loadBlocker(userId);
      data.active = Boolean(active);
      data.domains = normalizeDomains(domains);
      data.endsAt = data.active && typeof endsAt === 'number' ? endsAt : null;
      await saveBlocker(userId, data);
      res.json(blockerView(userId, data));
    })
  );

  app.post(
    '/api/blocker/attempt',
    handle('Blocker attempt', async (req, res) => {
      const userId = await requireUser(req, res);
      if (!userId) return;
      const { domain } = req.body as { domain?: string };
      const data = await loadBlocker(userId);
      data.attempts += 1;
      data.lastAttempt = {
        domain: typeof domain === 'string' ? domain.slice(0, 253) : 'inconnu',
        at: Date.now(),
      };
      await saveBlocker(userId, data);
      res.json(blockerView(userId, data));
    })
  );

  // Create HTTP server to share the port with Express, Vite, and Gemini Live WebSocket (`/live`)
  const server = http.createServer(app);

  // --- Gemini Live API (gemini-3.8-live) WebSocket Bridge ---
  const wss = new WebSocketServer({ noServer: true });

  // Outils de pilotage vocal : exécutés côté navigateur, relayés par ce pont.
  const LIVE_TOOLS: FunctionDeclaration[] = [
    {
      name: 'start_focus',
      description:
        "Démarre une session de concentration (Pomodoro). Si un titre de tâche est donné, la tâche est sélectionnée (ou créée si elle n'existe pas).",
      parameters: {
        type: Type.OBJECT,
        properties: {
          minutes: { type: Type.INTEGER, description: 'Durée en minutes (1 à 180). Par défaut : durée configurée.', minimum: 1, maximum: 180 },
          task_title: { type: Type.STRING, description: 'Titre de la tâche sur laquelle se concentrer.' },
        },
      },
    },
    { name: 'pause_timer', description: 'Met le minuteur en pause.' },
    { name: 'resume_timer', description: 'Reprend le minuteur en pause.' },
    { name: 'skip_phase', description: 'Passe à la phase suivante (concentration → pause, ou pause → concentration).' },
    { name: 'reset_timer', description: 'Réinitialise le minuteur de la phase en cours.' },
    {
      name: 'start_break',
      description: 'Démarre une pause.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          kind: { type: Type.STRING, enum: ['short', 'long'], format: 'enum', description: 'Pause courte (short) ou longue (long). Par défaut : courte.' },
        },
      },
    },
    {
      name: 'add_task',
      description: 'Ajoute une tâche à la liste.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          title: { type: Type.STRING, description: 'Titre de la tâche.' },
          estimated_pomodoros: { type: Type.INTEGER, description: 'Nombre de Pomodoros estimés.', minimum: 1, maximum: 20 },
          category: { type: Type.STRING, description: 'Catégorie ou projet de la tâche.' },
          due: { type: Type.STRING, enum: ['today', 'tomorrow'], format: 'enum', description: "Échéance : aujourd'hui (today) ou demain (tomorrow)." },
        },
        required: ['title'],
      },
    },
    {
      name: 'complete_task',
      description: 'Marque une tâche comme terminée (le titre peut être approximatif).',
      parameters: {
        type: Type.OBJECT,
        properties: { title: { type: Type.STRING, description: 'Titre (approximatif) de la tâche.' } },
        required: ['title'],
      },
    },
    {
      name: 'get_status',
      description:
        "Renvoie l'état actuel : phase, temps restant, tâche active, Pomodoros réalisés aujourd'hui et objectif du jour.",
    },
  ];
  const LIVE_TOOL_NAMES = new Set(LIVE_TOOLS.map((t) => t.name as string));
  const TOOL_TIMEOUT_MS = 8000;
  const MAX_TOOL_RESPONSE_BYTES = 8 * 1024;

  /** Corrèle les appels d'outils Gemini avec les réponses du navigateur (id + délai). */
  function createToolRelay(opts: {
    sendToClient: (payload: unknown) => boolean;
    respond: (responses: FunctionResponse[]) => void;
    timeoutMs?: number;
  }) {
    const pending = new Map<string, { name: string; timer: ReturnType<typeof setTimeout> }>();
    let seq = 0;
    const finish = (id: string, response: Record<string, unknown>) => {
      const entry = pending.get(id);
      if (!entry) return false;
      clearTimeout(entry.timer);
      pending.delete(id);
      opts.respond([{ id, name: entry.name, response }]);
      return true;
    };
    return {
      pendingCount: () => pending.size,
      handleCalls(calls: { id?: string; name?: string; args?: Record<string, unknown> }[]) {
        for (const call of calls) {
          const name = typeof call.name === 'string' ? call.name : '';
          const id = typeof call.id === 'string' && call.id ? call.id : `call-${Date.now()}-${++seq}`;
          if (!LIVE_TOOL_NAMES.has(name)) {
            opts.respond([{ id, name, response: { ok: false, error: 'outil inconnu' } }]);
            continue;
          }
          const timer = setTimeout(() => finish(id, { ok: false, error: 'timeout' }), opts.timeoutMs ?? TOOL_TIMEOUT_MS);
          pending.set(id, { name, timer });
          const args = call.args && typeof call.args === 'object' ? call.args : {};
          if (!opts.sendToClient({ toolCall: { id, name, args } })) {
            finish(id, { ok: false, error: 'client déconnecté' });
          }
        }
      },
      handleClientResponse(raw: unknown) {
        if (!raw || typeof raw !== 'object') return false;
        const { id, response } = raw as { id?: unknown; response?: unknown };
        if (typeof id !== 'string' || id.length > 256 || !pending.has(id)) return false;
        let safe: Record<string, unknown> =
          response && typeof response === 'object' && !Array.isArray(response)
            ? (response as Record<string, unknown>)
            : { ok: false, error: 'réponse invalide' };
        try {
          if (Buffer.byteLength(JSON.stringify(safe)) > MAX_TOOL_RESPONSE_BYTES) {
            safe = { ok: false, error: 'réponse trop volumineuse' };
          }
        } catch {
          safe = { ok: false, error: 'réponse non sérialisable' };
        }
        return finish(id, safe);
      },
      cancel(ids: string[]) {
        const cancelled: string[] = [];
        for (const id of ids) {
          const entry = pending.get(id);
          if (!entry) continue;
          clearTimeout(entry.timer);
          pending.delete(id);
          cancelled.push(id);
        }
        return cancelled;
      },
      dispose() {
        for (const entry of pending.values()) clearTimeout(entry.timer);
        pending.clear();
      },
    };
  }

  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`).pathname;
    if (pathname === '/live') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', async (clientWs: WebSocket, req) => {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
      clientWs.send(
        JSON.stringify({
          error:
            'Clé GEMINI_API_KEY manquante. Veuillez configurer votre clé dans Settings > Secrets.',
        })
      );
      clientWs.close();
      return;
    }

    const reqUrl = new URL(req.url || '/live', `http://${req.headers.host || 'localhost'}`);
    // Réservé aux utilisateurs connectés : la clé Gemini du serveur n'est pas publique
    const liveUserId = await resolveUserId(reqUrl.searchParams.get('token')).catch(() => null);
    if (!liveUserId) {
      clientWs.send(JSON.stringify({ error: 'Connectez-vous à Kronova pour parler à l’assistant.' }));
      clientWs.close();
      return;
    }
    const contextTask = reqUrl.searchParams.get('task') || 'Session libre';
    const contextPhase = reqUrl.searchParams.get('phase') || 'Concentration';
    const voiceName = reqUrl.searchParams.get('voice') || 'Zephyr';

    const ai = new GoogleGenAI({ apiKey });
    let liveSession: Awaited<ReturnType<typeof ai.live.connect>> | null = null;
    const toolRelay = createToolRelay({
      sendToClient: (payload) => {
        if (clientWs.readyState !== WebSocket.OPEN) return false;
        clientWs.send(JSON.stringify(payload));
        return true;
      },
      respond: (functionResponses) => {
        try {
          liveSession?.sendToolResponse({ functionResponses });
        } catch (err) {
          console.error('Error sending tool response to Live session:', err);
        }
      },
    });

    try {
      liveSession = await ai.live.connect({
        model: 'gemini-3.8-live',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName } },
          },
          systemInstruction: [
            "Tu es l'assistant vocal de Kronova, une application de gestion du temps.",
            "Tu discutes librement de tous les sujets que l'utilisateur aborde : œuvres d'art, littérature, cinéma, musique, histoire, sciences, actualité, culture générale, questions pratiques ou personnelles, comme un interlocuteur cultivé, curieux et chaleureux.",
            "Ne ramène pas la conversation vers la concentration, la productivité ou la méthode Pomodoro, sauf si l'utilisateur le demande.",
            `Contexte, à n'utiliser que si l'utilisateur en parle : phase « ${contextPhase} », tâche « ${contextTask} ».`,
            "Réponds dans la langue de l'utilisateur (français par défaut), de façon naturelle, vivante et sans détour.",
            "Quand l'utilisateur te le demande, tu peux piloter Kronova avec tes outils (minuteur, pauses, tâches, état) ; confirme alors brièvement l'action effectuée.",
          ].join(' '),
          tools: [{ functionDeclarations: LIVE_TOOLS }],
        },
        callbacks: {
          onopen: () => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(JSON.stringify({ status: 'connected' }));
            }
          },
          onmessage: (message: LiveServerMessage) => {
            if (clientWs.readyState !== WebSocket.OPEN) return;

            const parts = message.serverContent?.modelTurn?.parts || [];
            for (const part of parts) {
              const audioData = part.inlineData?.data;
              if (audioData) {
                clientWs.send(JSON.stringify({ audio: audioData }));
              }
              if (part.text) {
                clientWs.send(JSON.stringify({ text: part.text }));
              }
            }

            if (message.serverContent?.interrupted) {
              clientWs.send(JSON.stringify({ interrupted: true }));
            }

            const functionCalls = message.toolCall?.functionCalls;
            if (functionCalls?.length) {
              toolRelay.handleCalls(functionCalls);
            }

            const cancelledIds = message.toolCallCancellation?.ids;
            if (cancelledIds?.length) {
              const ids = toolRelay.cancel(cancelledIds);
              if (ids.length) clientWs.send(JSON.stringify({ toolCallCancellation: { ids } }));
            }
          },
          onerror: (err: unknown) => {
            console.error('Gemini Live error:', err);
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.send(
                JSON.stringify({
                  error:
                    'Erreur lors de la session vocale Gemini Live. Vérifiez votre clé API dans Settings > Secrets.',
                })
              );
            }
          },
          onclose: () => {
            if (clientWs.readyState === WebSocket.OPEN) {
              clientWs.close();
            }
          },
        },
      });
    } catch (err) {
      console.error('Failed to connect to gemini-3.8-live:', err);
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(
          JSON.stringify({
            error:
              'Impossible d’initialiser gemini-3.8-live. Vérifiez votre clé GEMINI_API_KEY dans Settings > Secrets.',
          })
        );
        clientWs.close();
      }
      return;
    }

    clientWs.on('message', (raw) => {
      try {
        const parsed = JSON.parse(raw.toString()) as { audio?: unknown; text?: string; toolResponse?: unknown };
        if (parsed.toolResponse !== undefined) {
          toolRelay.handleClientResponse(parsed.toolResponse);
          return;
        }
        if (typeof parsed.audio === 'string' && parsed.audio && liveSession) {
          liveSession.sendRealtimeInput({
            audio: {
              data: parsed.audio,
              mimeType: 'audio/pcm;rate=16000',
            },
          });
        }
      } catch (err) {
        console.error('Error forwarding audio chunk to Live session:', err);
      }
    });

    clientWs.on('close', () => {
      toolRelay.dispose();
      try {
        liveSession?.close();
      } catch {
        // Ignore close errors
      }
    });
  });

  // Vite middleware in development, static dist in production
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    // Fichiers hachés par Vite : immuables, mis en cache un an. Le reste (index.html, sw.js,
    // manifest) est revalidé à chaque visite pour que les mises à jour arrivent tout de suite.
    app.use(
      '/assets',
      express.static(path.join(distPath, 'assets'), { immutable: true, maxAge: '1y', index: false })
    );
    app.use(express.static(distPath, { maxAge: 0 }));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const shutdown = () => {
    server.close();
    changeStream?.close().catch(() => {});
    mongoose.disconnect().finally(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Kronova Full-Stack Server (MongoDB + Gemini Live) listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
