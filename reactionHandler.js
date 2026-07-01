// reactionHandler.js
// CommonJS - gère .setreact <emoji> : sauvegarde emoji en config utilisateur et forward du média cité
// Aucun message de succès envoyé (sauf erreur). Exporte handleSetReact.

const { jidNormalizedUser } = require('baileys'); // adapte si tu utilises un autre wrapper
const { loadUserConfigFromMongo, setUserConfigInMongo } = require('./pair.js'); // adapte le chemin

/**
 * Retourne le message cité (media ou texte) ou null
 * @param {object} msg
 * @returns {object|null}
 */
function detectQuoted(msg) {
  try {
    return msg?.message?.extendedTextMessage?.contextInfo?.quotedMessage || null;
  } catch (e) {
    return null;
  }
}

/**
 * Forward du message cité vers le JID du bot (save)
 * @param {object} socket
 * @param {object} msg
 * @param {string} from
 * @param {string} sender
 */
async function executeSave(socket, msg, from, sender) {
  const quoted = detectQuoted(msg);
  if (!quoted) {
    // On notifie l'utilisateur uniquement si pas de média cité
    await socket.sendMessage(sender, {
      text: '💾 Save\n\n❌ Réponds à un média avec la commande'
    }, { quoted: msg });
    return;
  }

  try {
    const userJid = jidNormalizedUser(socket.user.id);
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
    // Pas de réaction de succès ni message texte
  } catch (err) {
    console.error('[SETREACT SAVE ERROR]', err);
    // On informe l'utilisateur uniquement en cas d'erreur
    try {
      await socket.sendMessage(sender, {
        text: `❌ Erreur lors du transfert: ${err.message || err}`
      }, { quoted: msg });
    } catch (sendErr) {
      console.error('[SETREACT SEND ERROR]', sendErr);
    }
  }
}

/**
 * Handler principal pour .setreact <emoji>
 * - sauvegarde l'emoji dans la config utilisateur (champ SAVE_EMOJI)
 * - exécute executeSave pour forwarder le média cité
 *
 * @param {object} socket
 * @param {object} msg
 * @param {string[]} args
 * @param {string} from
 * @param {string} sender
 * @param {string} number
 */
async function handleSetReact(socket, msg, args, from, sender, number) {
  try {
    const emoji = (args && args[0]) ? args[0].trim() : '';
    if (!emoji) {
      await socket.sendMessage(sender, {
        text: '❗ Usage: .setreact <emoji>\nExemple: .setreact ❤️'
      }, { quoted: msg });
      return;
    }

    // sanitize number for DB key
    const sanitized = (number || '').toString().replace(/[^0-9]/g, '');
    let cfg = {};
    try {
      cfg = (typeof loadUserConfigFromMongo === 'function') ? await loadUserConfigFromMongo(sanitized) : {};
      if (!cfg || typeof cfg !== 'object') cfg = {};
    } catch (dbErr) {
      console.error('[SETREACT] loadUserConfigFromMongo error', dbErr);
      cfg = {};
    }

    // ensure array and push unique
    if (!Array.isArray(cfg.SAVE_EMOJI)) cfg.SAVE_EMOJI = [];
    if (!cfg.SAVE_EMOJI.includes(emoji)) {
      cfg.SAVE_EMOJI.push(emoji);
      try {
        if (typeof setUserConfigInMongo === 'function') {
          await setUserConfigInMongo(sanitized, cfg);
        } else {
          console.warn('[SETREACT] setUserConfigInMongo not defined');
        }
      } catch (saveErr) {
        console.error('[SETREACT] setUserConfigInMongo error', saveErr);
        // on continue quand même vers executeSave, mais on notifie l'erreur
        await socket.sendMessage(sender, {
          text: `⚠️ Emoji enregistré localement mais erreur DB: ${saveErr.message || saveErr}`
        }, { quoted: msg });
      }
    }

    // Forward du média cité
    await executeSave(socket, msg, from, sender);

  } catch (err) {
    console.error('[handleSetReact ERROR]', err);
    try {
      await socket.sendMessage(sender, { text: `❌ Erreur interne: ${err.message || err}` }, { quoted: msg });
    } catch (sendErr) {
      console.error('[handleSetReact SEND ERROR]', sendErr);
    }
  }
}

module.exports = {
  handleSetReact,
  executeSave,
  detectQuoted
};