// local_db.js — Ranplase MongoDB ak fichye JSON lokal
// Chak "koleksyon" = yon fichye JSON nan dossye ./data/

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(process.cwd(), 'data');

// Kreye dossye data si li pa egziste
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ── Utilitè ──────────────────────────────────────────────────

function filePath(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

function readDB(name) {
  const fp = filePath(name);
  try {
    if (!fs.existsSync(fp)) return {};
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch (e) {
    console.error(`[LocalDB] readDB(${name}) error:`, e.message);
    return {};
  }
}

function writeDB(name, data) {
  try {
    fs.writeFileSync(filePath(name), JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    console.error(`[LocalDB] writeDB(${name}) error:`, e.message);
  }
}

function sanitize(number) {
  return String(number || '').replace(/[^0-9]/g, '');
}

// ── initMongo — pa fè anyen (kompatibilite) ──────────────────
async function initMongo() { /* no-op */ }

// ── Sessions (creds WhatsApp) ─────────────────────────────────

async function saveCredsToMongo(number, creds, keys = null) {
  const n = sanitize(number);
  const db = readDB('sessions');
  db[n] = { number: n, creds, keys, updatedAt: new Date().toISOString() };
  writeDB('sessions', db);
  console.log(`[LocalDB] Saved creds for ${n}`);
}

async function loadCredsFromMongo(number) {
  const n = sanitize(number);
  const db = readDB('sessions');
  return db[n] || null;
}

async function removeSessionFromMongo(number) {
  const n = sanitize(number);
  const db = readDB('sessions');
  delete db[n];
  writeDB('sessions', db);
  console.log(`[LocalDB] Removed session for ${n}`);
}

// ── Numbers ───────────────────────────────────────────────────

async function addNumberToMongo(number) {
  const n = sanitize(number);
  const db = readDB('numbers');
  db[n] = { number: n };
  writeDB('numbers', db);
}

async function removeNumberFromMongo(number) {
  const n = sanitize(number);
  const db = readDB('numbers');
  delete db[n];
  writeDB('numbers', db);
}

async function getAllNumbersFromMongo() {
  const db = readDB('numbers');
  return Object.keys(db);
}

// ── Admins ────────────────────────────────────────────────────

async function loadAdminsFromMongo() {
  const db = readDB('admins');
  return Object.keys(db);
}

async function addAdminToMongo(jidOrNumber) {
  const db = readDB('admins');
  db[jidOrNumber] = { jid: jidOrNumber };
  writeDB('admins', db);
}

async function removeAdminFromMongo(jidOrNumber) {
  const db = readDB('admins');
  delete db[jidOrNumber];
  writeDB('admins', db);
}

// ── Newsletter ────────────────────────────────────────────────

async function addNewsletterToMongo(jid, emojis = []) {
  const db = readDB('newsletter_list');
  db[jid] = { jid, emojis: Array.isArray(emojis) ? emojis : [], addedAt: new Date().toISOString() };
  writeDB('newsletter_list', db);
}

async function removeNewsletterFromMongo(jid) {
  const db = readDB('newsletter_list');
  delete db[jid];
  writeDB('newsletter_list', db);
}

async function listNewslettersFromMongo() {
  const db = readDB('newsletter_list');
  return Object.values(db).map(d => ({ jid: d.jid, emojis: Array.isArray(d.emojis) ? d.emojis : [] }));
}

async function saveNewsletterReaction(jid, messageId, emoji, sessionNumber) {
  const db = readDB('newsletter_reactions_log');
  const key = `${jid}_${messageId}_${Date.now()}`;
  db[key] = { jid, messageId, emoji, sessionNumber, ts: new Date().toISOString() };
  writeDB('newsletter_reactions_log', db);
}

// ── Newsletter React Config ───────────────────────────────────

async function addNewsletterReactConfig(jid, emojis = []) {
  const db = readDB('newsletter_reacts');
  db[jid] = { jid, emojis, addedAt: new Date().toISOString() };
  writeDB('newsletter_reacts', db);
}

async function removeNewsletterReactConfig(jid) {
  const db = readDB('newsletter_reacts');
  delete db[jid];
  writeDB('newsletter_reacts', db);
}

async function listNewsletterReactsFromMongo() {
  const db = readDB('newsletter_reacts');
  return Object.values(db).map(d => ({ jid: d.jid, emojis: Array.isArray(d.emojis) ? d.emojis : [] }));
}

async function getReactConfigForJid(jid) {
  const db = readDB('newsletter_reacts');
  const doc = db[jid];
  return doc ? (Array.isArray(doc.emojis) ? doc.emojis : []) : null;
}

// ── User Config ───────────────────────────────────────────────

async function setUserConfigInMongo(number, conf) {
  const n = sanitize(number);
  const db = readDB('configs');
  db[n] = { number: n, config: conf, updatedAt: new Date().toISOString() };
  writeDB('configs', db);
}

async function loadUserConfigFromMongo(number) {
  const n = sanitize(number);
  const db = readDB('configs');
  return db[n] ? db[n].config : null;
}

// ── Restart Schedule ──────────────────────────────────────────

async function getRestartSchedule() {
  const db = readDB('restart_schedule');
  return db['schedule'] || null;
}

async function setRestartSchedule(minutes) {
  const db = readDB('restart_schedule');
  db['schedule'] = { minutes, active: true, updatedAt: Date.now() };
  writeDB('restart_schedule', db);
}

async function stopRestartSchedule() {
  const db = readDB('restart_schedule');
  db['schedule'] = { ...(db['schedule'] || {}), active: false, updatedAt: Date.now() };
  writeDB('restart_schedule', db);
}

// ── Status Infractions ────────────────────────────────────────

function infraKey(s, g, p) { return `${s}__${g}__${p}`; }

async function ensureStatusInfractionsIndex() { /* no-op */ }

async function getStatusInfractionDoc(sessionId, groupId, participant) {
  const s = String(sessionId || '');
  const g = String(groupId || '');
  const p = String(participant || '');
  if (!s || !g || !p) return null;
  const db = readDB('status_infractions');
  return db[infraKey(s, g, p)] || null;
}

async function incrStatusInfraction(sessionId, groupId, participant) {
  const s = String(sessionId || '');
  const g = String(groupId || '');
  const p = String(participant || '');
  if (!s || !g || !p) return 1;
  const db = readDB('status_infractions');
  const key = infraKey(s, g, p);
  const current = db[key] || { count: 0 };
  current.count = (current.count || 0) + 1;
  current.lastAt = Date.now();
  db[key] = current;
  writeDB('status_infractions', db);
  return current.count;
}

async function resetStatusInfraction(sessionId, groupId, participant) {
  const s = String(sessionId || '');
  const g = String(groupId || '');
  const p = String(participant || '');
  if (!s || !g || !p) return false;
  const db = readDB('status_infractions');
  delete db[infraKey(s, g, p)];
  writeDB('status_infractions', db);
  return true;
}

async function setStatusInfractionCount(sessionId, groupId, participant, count) {
  const s = String(sessionId || '');
  const g = String(groupId || '');
  const p = String(participant || '');
  const c = Number.isFinite(Number(count)) ? Number(count) : 0;
  if (!s || !g || !p) return false;
  const db = readDB('status_infractions');
  db[infraKey(s, g, p)] = { count: c, lastAt: Date.now() };
  writeDB('status_infractions', db);
  return true;
}

// ── Exports ───────────────────────────────────────────────────

module.exports = {
  initMongo,
  saveCredsToMongo,
  loadCredsFromMongo,
  removeSessionFromMongo,
  addNumberToMongo,
  removeNumberFromMongo,
  getAllNumbersFromMongo,
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
};
