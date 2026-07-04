// welcome_goodbye.js
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

function ensureGroup(from) {
  if (!groups[from]) {
    groups[from] = {
      welcome: false,
      goodbye: false,
      welcomeMsg: null,
      goodbyeMsg: null
    };
  }
}

function toggleWelcome(from, state) {
  ensureGroup(from);
  groups[from].welcome = !!state;
}

function toggleGoodbye(from, state) {
  ensureGroup(from);
  groups[from].goodbye = !!state;
}

function isWelcomeEnabled(from) {
  return !!(groups[from] && groups[from].welcome);
}

function isGoodbyeEnabled(from) {
  return !!(groups[from] && groups[from].goodbye);
}

function setWelcomeTemplate(from, template) {
  ensureGroup(from);
  if (typeof template === 'string' && template.trim()) groups[from].welcomeMsg = template.trim();
}

function setGoodbyeTemplate(from, template) {
  ensureGroup(from);
  if (typeof template === 'string' && template.trim()) groups[from].goodbyeMsg = template.trim();
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
      if (update.action === 'add' && isWelcomeEnabled(from)) {
        ensureGroup(from);
        const tpl = groups[from].welcomeMsg;
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
      if ((update.action === 'remove' || update.action === 'leave') && isGoodbyeEnabled(from)) {
        ensureGroup(from);
        const tpl = groups[from].goodbyeMsg;
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
