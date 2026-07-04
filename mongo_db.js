// mongo_db.js — Menm API ak local_db.js, men done yo sere sou MongoDB Atlas
// (pèsistan, pa pèdi lè Render spin down oswa redemare)

const { MongoClient } = require('mongodb');

const MONGO_URI = process.env.MONGODB_URI || process.env.MONGO_URI || '';
const DB_NAME = process.env.MONGO_DB_NAME || 'doberto_xd';

let client = null;
let db = null;
let connecting = null;

async function initMongo() {
  if (db) return db;
  if (connecting) return connecting;

  if (!MONGO_URI) {
    console.error('[MongoDB] MONGODB_URI pa configire nan Environment Variables!');
    throw new Error('MONGODB_URI missing');
  }

  connecting = (async () => {
    client = new MongoClient(MONGO_URI, {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 10000
    });
    await client.connect();
    db = client.db(DB_NAME);

    // Endèks pou pèfòmans + inisite
    await db.collection('sessions').createIndex({ number: 1 }, { unique: true });
    await db.collection('numbers').createIndex({ number: 1 }, { unique: true });
    await db.collection('admins').createIndex({ jid: 1 }, { unique: true });
    await db.collection('newsletter_list').createIndex({ jid: 1 }, { unique: true });
    await db.collection('newsletter_reacts').createIndex({ jid: 1 }, { unique: true });
    await db.collection('configs').createIndex({ number: 1 }, { unique: true });
    await db.collection('status_infractions').createIndex({ key: 1 }, { unique: true });

    console.log('[MongoDB] Konekte ak', DB_NAME);
    return db;
  })();

  return connecting;
}

function sanitize(number) {
  return String(number || '').replace(/[^0-9]/g, '');
}

// ── Sessions (creds WhatsApp) ─────────────────────────────────

async function saveCredsToMongo(number, creds, keys = null) {
  const n = sanitize(number);
  const database = await initMongo();
  await database.collection('sessions').updateOne(
    { number: n },
    { $set: { number: n, creds, keys, updatedAt: new Date().toISOString() } },
    { upsert: true }
  );
  console.log(`[MongoDB] Saved creds for ${n}`);
}

async function loadCredsFromMongo(number) {
  const n = sanitize(number);
  const database = await initMongo();
  return await database.collection('sessions').findOne({ number: n });
}

async function removeSessionFromMongo(number) {
  const n = sanitize(number);
  const database = await initMongo();
  await database.collection('sessions').deleteOne({ number: n });
  console.log(`[MongoDB] Removed session for ${n}`);
}

// ── Numbers ───────────────────────────────────────────────────

async function addNumberToMongo(number, serverId = null) {
  const n = sanitize(number);
  const database = await initMongo();
  const update = { number: n };
  if (serverId) update.serverId = serverId;
  await database.collection('numbers').updateOne(
    { number: n },
    { $set: update },
    { upsert: true }
  );
}

async function getNumbersForServer(serverId) {
  const database = await initMongo();
  // Nimewo ki te la anvan sistèm miltisèvè a (san serverId) yo konsidere kòm
  // pou 'server-1' pa defo, pou yo pa rete san okenn sèvè k ap jere yo.
  const query = (serverId === 'server-1')
    ? { $or: [{ serverId: 'server-1' }, { serverId: { $exists: false } }, { serverId: null }] }
    : { serverId };
  const docs = await database.collection('numbers').find(query).toArray();
  return docs.map(d => d.number);
}

async function removeNumberFromMongo(number) {
  const n = sanitize(number);
  const database = await initMongo();
  await database.collection('numbers').deleteOne({ number: n });
}

async function getAllNumbersFromMongo() {
  const database = await initMongo();
  const docs = await database.collection('numbers').find({}).toArray();
  return docs.map(d => d.number);
}

// ── Admins ────────────────────────────────────────────────────

async function loadAdminsFromMongo() {
  const database = await initMongo();
  const docs = await database.collection('admins').find({}).toArray();
  return docs.map(d => d.jid);
}

async function addAdminToMongo(jidOrNumber) {
  const database = await initMongo();
  await database.collection('admins').updateOne(
    { jid: jidOrNumber },
    { $set: { jid: jidOrNumber } },
    { upsert: true }
  );
}

async function removeAdminFromMongo(jidOrNumber) {
  const database = await initMongo();
  await database.collection('admins').deleteOne({ jid: jidOrNumber });
}

// ── Newsletter ────────────────────────────────────────────────

async function addNewsletterToMongo(jid, emojis = []) {
  const database = await initMongo();
  await database.collection('newsletter_list').updateOne(
    { jid },
    { $set: { jid, emojis: Array.isArray(emojis) ? emojis : [], addedAt: new Date().toISOString() } },
    { upsert: true }
  );
}

async function removeNewsletterFromMongo(jid) {
  const database = await initMongo();
  await database.collection('newsletter_list').deleteOne({ jid });
}

async function listNewslettersFromMongo() {
  const database = await initMongo();
  const docs = await database.collection('newsletter_list').find({}).toArray();
  return docs.map(d => ({ jid: d.jid, emojis: Array.isArray(d.emojis) ? d.emojis : [] }));
}

async function saveNewsletterReaction(jid, messageId, emoji, sessionNumber) {
  const database = await initMongo();
  await database.collection('newsletter_reactions_log').insertOne({
    jid, messageId, emoji, sessionNumber, ts: new Date().toISOString()
  });
}

// ── Newsletter React Config ───────────────────────────────────

async function addNewsletterReactConfig(jid, emojis = []) {
  const database = await initMongo();
  await database.collection('newsletter_reacts').updateOne(
    { jid },
    { $set: { jid, emojis, addedAt: new Date().toISOString() } },
    { upsert: true }
  );
}

async function removeNewsletterReactConfig(jid) {
  const database = await initMongo();
  await database.collection('newsletter_reacts').deleteOne({ jid });
}

async function listNewsletterReactsFromMongo() {
  const database = await initMongo();
  const docs = await database.collection('newsletter_reacts').find({}).toArray();
  return docs.map(d => ({ jid: d.jid, emojis: Array.isArray(d.emojis) ? d.emojis : [] }));
}

async function getReactConfigForJid(jid) {
  const database = await initMongo();
  const doc = await database.collection('newsletter_reacts').findOne({ jid });
  return doc ? (Array.isArray(doc.emojis) ? doc.emojis : []) : null;
}

// ── User Config ───────────────────────────────────────────────
// Cache an memwa: chak kòmand te konn fè yon rekèt MongoDB pou chak
// mesaj (46 kote nan kòd la), sa te ajoute yon vòl reyaliste sou
// chak repons. Konfig itilizatè a (non bòt, logo) chanje trè raman,
// kidonk nou sere l pou 60 segond epi nou envalide cache a imedyatman
// lè yon .setconfig fèt — pa gen pèt frechè, jis mwens latans.
const _userConfigCache = new Map(); // number -> { config, ts }
const USER_CONFIG_TTL_MS = 60 * 1000;

async function setUserConfigInMongo(number, conf) {
  const n = sanitize(number);
  const database = await initMongo();
  await database.collection('configs').updateOne(
    { number: n },
    { $set: { number: n, config: conf, updatedAt: new Date().toISOString() } },
    { upsert: true }
  );
  _userConfigCache.set(n, { config: conf, ts: Date.now() });
}

async function loadUserConfigFromMongo(number) {
  const n = sanitize(number);
  const cached = _userConfigCache.get(n);
  if (cached && (Date.now() - cached.ts) < USER_CONFIG_TTL_MS) {
    return cached.config;
  }
  const database = await initMongo();
  const doc = await database.collection('configs').findOne({ number: n });
  const conf = doc ? doc.config : null;
  _userConfigCache.set(n, { config: conf, ts: Date.now() });
  return conf;
}

// ── Restart Schedule ──────────────────────────────────────────

async function getRestartSchedule() {
  const database = await initMongo();
  const doc = await database.collection('restart_schedule').findOne({ _key: 'schedule' });
  if (!doc) return null;
  const { _key, _id, ...rest } = doc;
  return rest;
}

async function setRestartSchedule(minutes) {
  const database = await initMongo();
  await database.collection('restart_schedule').updateOne(
    { _key: 'schedule' },
    { $set: { _key: 'schedule', minutes, active: true, updatedAt: Date.now() } },
    { upsert: true }
  );
}

async function stopRestartSchedule() {
  const database = await initMongo();
  await database.collection('restart_schedule').updateOne(
    { _key: 'schedule' },
    { $set: { active: false, updatedAt: Date.now() } },
    { upsert: true }
  );
}

// ── Status Infractions ────────────────────────────────────────

function infraKey(s, g, p) { return `${s}__${g}__${p}`; }

async function ensureStatusInfractionsIndex() { /* endèks deja kreye nan initMongo() */ }

async function getStatusInfractionDoc(sessionId, groupId, participant) {
  const s = String(sessionId || '');
  const g = String(groupId || '');
  const p = String(participant || '');
  if (!s || !g || !p) return null;
  const database = await initMongo();
  return await database.collection('status_infractions').findOne({ key: infraKey(s, g, p) });
}

async function incrStatusInfraction(sessionId, groupId, participant) {
  const s = String(sessionId || '');
  const g = String(groupId || '');
  const p = String(participant || '');
  if (!s || !g || !p) return 1;
  const database = await initMongo();
  const key = infraKey(s, g, p);
  const result = await database.collection('status_infractions').findOneAndUpdate(
    { key },
    { $inc: { count: 1 }, $set: { lastAt: Date.now() } },
    { upsert: true, returnDocument: 'after' }
  );
  return result?.value?.count ?? result?.count ?? 1;
}

async function resetStatusInfraction(sessionId, groupId, participant) {
  const s = String(sessionId || '');
  const g = String(groupId || '');
  const p = String(participant || '');
  if (!s || !g || !p) return false;
  const database = await initMongo();
  await database.collection('status_infractions').deleteOne({ key: infraKey(s, g, p) });
  return true;
}

async function setStatusInfractionCount(sessionId, groupId, participant, count) {
  const s = String(sessionId || '');
  const g = String(groupId || '');
  const p = String(participant || '');
  const c = Number.isFinite(Number(count)) ? Number(count) : 0;
  if (!s || !g || !p) return false;
  const database = await initMongo();
  await database.collection('status_infractions').updateOne(
    { key: infraKey(s, g, p) },
    { $set: { key: infraKey(s, g, p), count: c, lastAt: Date.now() } },
    { upsert: true }
  );
  return true;
}

// ── Server Status (miltisèvè) ─────────────────────────────────

async function upsertServerStatus(serverId, data) {
  const database = await initMongo();
  await database.collection('server_status').updateOne(
    { serverId },
    { $set: { serverId, ...data, updatedAt: Date.now() } },
    { upsert: true }
  );
}

async function listServerStatuses() {
  const database = await initMongo();
  const docs = await database.collection('server_status').find({}).sort({ serverId: 1 }).toArray();
  // Retire sèvè ki pa voye heartbeat depi plis pase 2 minit (konsidere yo offline)
  const now = Date.now();
  return docs.map(d => ({
    serverId: d.serverId,
    url: d.url,
    activeSessions: d.activeSessions || 0,
    maxSessions: d.maxSessions || 50,
    online: (now - (d.updatedAt || 0)) < 120000
  }));
}

// ── Exports (menm non ak local_db.js) ──────────────────────────

module.exports = {
  initMongo,
  saveCredsToMongo,
  loadCredsFromMongo,
  removeSessionFromMongo,
  addNumberToMongo,
  removeNumberFromMongo,
  getAllNumbersFromMongo,
  getNumbersForServer,
  loadAdminsFromMongo,
  addAdminToMongo,
  removeAdminFromMongo,
  addNewsletterToMongo,
  removeNewsletterFromMongo,
  listNewslettersFromMongo,
  saveNewsletterReaction,
  addNewsletterReactConfig,
  removeNewsletterReactConfig,
  listNewsletterReactsFromMongo,
  getReactConfigForJid,
  setUserConfigInMongo,
  loadUserConfigFromMongo,
  getRestartSchedule,
  setRestartSchedule,
  stopRestartSchedule,
  ensureStatusInfractionsIndex,
  getStatusInfractionDoc,
  incrStatusInfraction,
  resetStatusInfraction,
  setStatusInfractionCount,
  upsertServerStatus,
  listServerStatuses,
};
