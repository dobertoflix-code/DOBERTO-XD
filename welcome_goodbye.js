// welcome_goodbye.js
const { getGroupSettings, setGroupSettings } = require('./mongo_db');

// Cache en mémoire = juste pour la vitesse (évite un aller-retour Mongo à
// chaque message). La SOURCE DE VÉRITÉ reste MongoDB : si le processus
// redémarre, "groups" repart vide mais ensureGroup() recharge automatiquement
// depuis Mongo dès la première utilisation dans chaque groupe.
const groups = {};

// Image bot par défaut si pas de photo de profil
const BOT_IMAGE = 'https://i.ibb.co/GQ0pdH2t/IMG-20260504-WA0032.jpg';

// JID newsletter
const NEWSLETTER_JID = '120363407485857714@newsletter';

const newsletterCtx = {
  forwardingScore: 999,
  isForwarded: true,
  forwardedNewsletterMessageInfo: {
    newsletterJid: NEWSLETTER_JID,
    newsletterName: 'Doberto XD',
    serverMessageId: 143
  }
};

// Récupérer les infos du groupe
async function getGroupInfo(socket, from) {
  try {
    const meta = await socket.groupMetadata(from);
    const memberCount = meta.participants.length;
    const adminCount  = meta.participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin').length;
    return { memberCount, adminCount };
  } catch (e) {
    return { memberCount: 0, adminCount: 0 };
  }
}

// Date formatée
function getDate() {
  return new Date().toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    timeZone: 'America/Port-au-Prince'
  });
}

async function buildDefaultWelcome(socket, userJid, userName, groupName, from) {
  const { memberCount, adminCount } = await getGroupInfo(socket, from);
  return [
    `*╭───────────◇*`,
    `│ ✧ ʙᴏᴛ: DOBERTO-XD`,
    `│ ✧ ɢʀᴏᴜᴘ: ${groupName}`,
    `│ ✧ ᴀᴅᴍɪɴ: ${adminCount}`,
    `│ ✧ ᴅᴀᴛᴇ: ${getDate()}`,
    `│ ✧ ᴍᴇᴍʙᴇʀs: ${memberCount}`,
    `│ ✧ ᴜsᴇʀ: @${userName}`,
    `*╰───────────◇*`,
    ``,
    `👋 Byenveni nan *${groupName}* !`,
    ``,
    `> *© ᴍᴀᴅᴇ ʙʏ DOBERTO*`
  ].join('\n');
}

async function buildDefaultGoodbye(socket, userJid, userName, groupName, from) {
  const { memberCount, adminCount } = await getGroupInfo(socket, from);
  return [
    `*╭───────────◇*`,
    `│ ✧ ʙᴏᴛ: DOBERTO-XD`,
    `│ ✧ ɢʀᴏᴜᴘ: ${groupName}`,
    `│ ✧ ᴀᴅᴍɪɴ: ${adminCount}`,
    `│ ✧ ᴅᴀᴛᴇ: ${getDate()}`,
    `│ ✧ ᴍᴇᴍʙᴇʀs: ${memberCount}`,
    `│ ✧ ᴜsᴇʀ: @${userName}`,
    `*╰───────────◇*`,
    ``,
    `✋ *@${userName}* kite *${groupName}*`,
    ``,
    `> *© ᴍᴀᴅᴇ ʙʏ DOBERTO*`
  ].join('\n');
}

// Charge (une seule fois par groupe, puis mise en cache) l'état depuis MongoDB.
// Si Mongo est indisponible, on retombe sur les valeurs par défaut sans planter.
async function ensureGroup(from) {
  if (!groups[from]) {
    let saved = null;
    try {
      saved = await getGroupSettings(from);
    } catch (e) {
      console.error('[WELCOME_GOODBYE] Erreur chargement Mongo pour', from, e.message);
    }
    groups[from] = {
      welcome: !!(saved && saved.welcome),
      goodbye: !!(saved && saved.goodbye),
      welcomeMsg: (saved && saved.welcomeMsg) || null,
      goodbyeMsg: (saved && saved.goodbyeMsg) || null
    };
  }
  return groups[from];
}

async function toggleWelcome(from, state) {
  const g = await ensureGroup(from);
  g.welcome = !!state;
  await setGroupSettings(from, { welcome: g.welcome });
}

async function toggleGoodbye(from, state) {
  const g = await ensureGroup(from);
  g.goodbye = !!state;
  await setGroupSettings(from, { goodbye: g.goodbye });
}

async function isWelcomeEnabled(from) {
  const g = await ensureGroup(from);
  return !!g.welcome;
}

async function isGoodbyeEnabled(from) {
  const g = await ensureGroup(from);
  return !!g.goodbye;
}

async function setWelcomeTemplate(from, template) {
  const g = await ensureGroup(from);
  // template === null (ou vide) → reset au message par défaut
  g.welcomeMsg = (typeof template === 'string' && template.trim()) ? template.trim() : null;
  await setGroupSettings(from, { welcomeMsg: g.welcomeMsg });
}

async function setGoodbyeTemplate(from, template) {
  const g = await ensureGroup(from);
  g.goodbyeMsg = (typeof template === 'string' && template.trim()) ? template.trim() : null;
  await setGroupSettings(from, { goodbyeMsg: g.goodbyeMsg });
}

function renderTemplateString(template, vars = {}) {
  return template
    .replace(/{user}/g, vars.user || '')
    .replace(/{userName}/g, vars.userName || '')
    .replace(/{group}/g, vars.group || '');
}

async function getProfilePicture(socket, jid) {
  try {
    return await socket.profilePictureUrl(jid, 'image');
  } catch (e) {
    return null;
  }
}

async function handleParticipantUpdate(socket, from, update) {
  try {
    if (!update || !update.action) return;

    const participants = Array.isArray(update.participants)
      ? update.participants
      : (update.participant ? [update.participant] : []);

    if (!participants.length) return;

    let groupName = '';
    try {
      const meta = await socket.groupMetadata(from);
      groupName = meta?.subject || from.split('@')[0];
    } catch (e) {
      groupName = from.split('@')[0];
    }

    for (const participant of participants) {
      const userJid = participant;
      const userName = (participant || '').split('@')[0];

      const profilePic = await getProfilePicture(socket, userJid) || BOT_IMAGE;

      // ARRIVÉE - BIENVENUE
      if (update.action === 'add' && await isWelcomeEnabled(from)) {
        const g = await ensureGroup(from);
        const tpl = g.welcomeMsg;
        const text = tpl
          ? renderTemplateString(tpl, { user: `@${userName}`, userName, group: groupName })
          : await buildDefaultWelcome(socket, userJid, userName, groupName, from);

        await socket.sendMessage(from, {
          image: { url: profilePic },
          caption: text,
          mentions: [userJid],
          contextInfo: newsletterCtx
        });
      }

      // DÉPART - AU REVOIR
      if ((update.action === 'remove' || update.action === 'leave') && await isGoodbyeEnabled(from)) {
        const g = await ensureGroup(from);
        const tpl = g.goodbyeMsg;
        const text = tpl
          ? renderTemplateString(tpl, { user: `@${userName}`, userName, group: groupName })
          : await buildDefaultGoodbye(socket, userJid, userName, groupName, from);

        await socket.sendMessage(from, {
          image: { url: profilePic },
          caption: text,
          mentions: [userJid],
          contextInfo: newsletterCtx
        });
      }
    }
  } catch (err) {
    console.error('ERREUR HANDLER WELCOME_GOODBYE', err);
  }
}

module.exports = {
  toggleWelcome,
  toggleGoodbye,
  isWelcomeEnabled,
  isGoodbyeEnabled,
  setWelcomeTemplate,
  setGoodbyeTemplate,
  handleParticipantUpdate
};
