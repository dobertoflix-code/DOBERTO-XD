// routes.js - Toutes les routes API et pages du dashboard
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const {
  listServerStatuses,
  addNewsletterToMongo,
  removeNewsletterFromMongo,
  listNewslettersFromMongo,
  loadAdminsFromMongo,
  addAdminToMongo,
  removeAdminFromMongo,
  removeSessionFromMongo,
  removeNumberFromMongo,
  listSessionsFromMongo,
} = require('./mongo_db');
const router = express.Router();

// ========== LIST DES SÈVÈ DISPONIB (pou paj "Choose a Server") ==========
router.get('/api/servers', async (req, res) => {
  try {
    const servers = await listServerStatuses();
    res.json({ servers });
  } catch (e) {
    res.status(500).json({ servers: [], error: e.message });
  }
});


// ========== 0. AUTHENTIFICATION DASHBOARD (Basic Auth) ==========
function safeCompare(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function requireDashboardAuth(req, res, next) {
  const user = process.env.DASHBOARD_USER || config.DASHBOARD_USER || 'admin';
  const pass = process.env.DASHBOARD_PASSWORD || config.DASHBOARD_PASSWORD;

  if (!pass) {
    return res.status(500).send(
      "⚠️ DASHBOARD_PASSWORD pa konfigire. Ajoute l nan config.js (DASHBOARD_PASSWORD) oswa kòm variable d'environnement DASHBOARD_PASSWORD anvan w itilize dashboard la."
    );
  }

  const authHeader = req.headers.authorization || '';
  const [scheme, encoded] = authHeader.split(' ');

  if (scheme === 'Basic' && encoded) {
    let decoded = '';
    try { decoded = Buffer.from(encoded, 'base64').toString('utf8'); } catch (e) {}
    const sepIndex = decoded.indexOf(':');
    const reqUser = sepIndex >= 0 ? decoded.slice(0, sepIndex) : decoded;
    const reqPass = sepIndex >= 0 ? decoded.slice(sepIndex + 1) : '';

    if (safeCompare(reqUser, user) && safeCompare(reqPass, pass)) {
      return next();
    }
  }

  res.set('WWW-Authenticate', 'Basic realm="DOBERTO-XD Dashboard"');
  return res.status(401).send('🔒 Authentification requise pour accéder au dashboard.');
}

// Pwoteje TOUT sa ki sou dashboard la ak API sansib yo (pa touche /code, ki pou koneksyon itilizatè)
router.use('/dashboard', requireDashboardAuth);
router.use('/api', requireDashboardAuth);
router.use('/admin', requireDashboardAuth);
router.use('/newsletter', requireDashboardAuth);
router.use('/connect-all', requireDashboardAuth);
router.use('/reconnect', requireDashboardAuth);

// ========== 1. D'ABORD LES ROUTES API (DOIVENT ÊTRE EN PREMIER) ==========

// API NEWSLETTERS
router.post('/newsletter/add', async (req, res) => {
  try {
    const { jid, emojis } = req.body;
    if (!jid) return res.status(400).json({ error: 'jid required' });
    if (!jid.endsWith('@newsletter')) return res.status(400).json({ error: 'Invalid newsletter jid' });

    const emojiList = Array.isArray(emojis)
      ? emojis
      : (typeof emojis === 'string' && emojis.trim()
          ? emojis.split(',').map(e => e.trim()).filter(Boolean)
          : []);

    await addNewsletterToMongo(jid, emojiList);
    console.log('Newsletter add:', { jid, emojis: emojiList });
    res.status(200).json({ status: 'ok', jid });
  } catch (e) { 
    console.error('Newsletter add error:', e);
    res.status(500).json({ error: e.message || e }); 
  }
});

router.post('/newsletter/remove', async (req, res) => {
  try {
    const { jid } = req.body;
    if (!jid) return res.status(400).json({ error: 'jid required' });

    await removeNewsletterFromMongo(jid);
    console.log('Newsletter remove:', jid);
    res.status(200).json({ status: 'ok', jid });
  } catch (e) { 
    console.error('Newsletter remove error:', e);
    res.status(500).json({ error: e.message || e }); 
  }
});

router.get('/newsletter/list', async (req, res) => {
  try {
    const docs = await listNewslettersFromMongo();
    const list = (docs || []).map(d => ({ jid: d.jid, emojis: d.emojis || [] }));
    res.status(200).json({ status: 'ok', channels: list });
  } catch (e) { 
    console.error('Newsletter list error:', e);
    res.status(500).json({ error: e.message || e }); 
  }
});

// API ADMINS
router.post('/admin/add', async (req, res) => {
  try {
    const { jid } = req.body;
    if (!jid) return res.status(400).json({ error: 'jid required' });

    await addAdminToMongo(jid);
    console.log('Admin add:', jid);
    res.status(200).json({ status: 'ok', jid });
  } catch (e) { 
    console.error('Admin add error:', e);
    res.status(500).json({ error: e.message || e }); 
  }
});

router.post('/admin/remove', async (req, res) => {
  try {
    const { jid } = req.body;
    if (!jid) return res.status(400).json({ error: 'jid required' });

    await removeAdminFromMongo(jid);
    console.log('Admin remove:', jid);
    res.status(200).json({ status: 'ok', jid });
  } catch (e) { 
    console.error('Admin remove error:', e);
    res.status(500).json({ error: e.message || e }); 
  }
});

router.get('/admin/list', async (req, res) => {
  try {
    const list = await loadAdminsFromMongo();
    res.status(200).json({ status: 'ok', admins: list || [] });
  } catch (e) { 
    console.error('Admin list error:', e);
    res.status(500).json({ error: e.message || e }); 
  }
});

// API SESSIONS
router.get('/connect', async (req, res) => {
  const { number } = req.query;
  if (!number) return res.status(400).json({ error: 'Number parameter is required' });
  
  res.status(200).json({ status: 'connection_initiated', number });
});

router.get('/active', (req, res) => {
  try {
    const pairModule = require('./pair');
    const activeSockets = pairModule.activeSockets;
    const numbers = activeSockets ? Array.from(activeSockets.keys()) : [];
    res.status(200).json({
      botName: 'DOBERTO-XD',
      count: numbers.length,
      numbers,
      timestamp: new Date().toISOString()
    });
  } catch (err) {
    res.status(200).json({ botName: 'DOBERTO-XD', count: 0, numbers: [], timestamp: new Date().toISOString() });
  }
});

router.get('/ping', (req, res) => {
  try {
    const pairModule = require('./pair');
    const activeSockets = pairModule.activeSockets;
    const activeSessions = activeSockets ? activeSockets.size : 0;
    res.status(200).json({
      status: 'active',
      botName: 'DOBERTO-XD',
      message: 'DOBERTO-XD',
      activeSessions
    });
  } catch (err) {
    res.status(200).json({ status: 'active', botName: 'DOBERTO-XD', message: 'DOBERTO-XD', activeSessions: 0 });
  }
});

router.get('/connect-all', async (req, res) => {
  try {
    res.status(200).json({ status: 'success', connections: [] });
  } catch (error) { 
    res.status(500).json({ error: 'Failed to connect all bots' }); 
  }
});

router.get('/reconnect', async (req, res) => {
  try {
    res.status(200).json({ status: 'success', connections: [] });
  } catch (error) { 
    res.status(500).json({ error: 'Failed to reconnect bots' }); 
  }
});

router.get('/update-config', async (req, res) => {
  const { number, config } = req.query;
  if (!number || !config) {
    return res.status(400).json({ error: 'Number and config are required' });
  }
  
  try {
    JSON.parse(config);
    res.status(200).json({ status: 'otp_sent', message: 'OTP sent to your number' });
  } catch (error) { 
    return res.status(400).json({ error: 'Invalid config format' }); 
  }
});

router.get('/verify-otp', async (req, res) => {
  const { number, otp } = req.query;
  if (!number || !otp) return res.status(400).json({ error: 'Number and OTP are required' });
  
  res.status(200).json({ status: 'success', message: 'Config updated successfully' });
});

router.get('/getabout', async (req, res) => {
  const { number, target } = req.query;
  if (!number || !target) {
    return res.status(400).json({ error: 'Number and target number are required' });
  }
  
  res.status(200).json({ 
    status: 'success', 
    number: target, 
    about: 'Example about text', 
    setAt: new Date().toISOString() 
  });
});

// API POUR LE DASHBOARD
router.get('/api/sessions', async (req, res) => {
  try {
    console.log('✅ API /api/sessions appelée');
    const sessions = await listSessionsFromMongo();
    res.json({ ok: true, sessions });
  } catch (err) {
    console.error('❌ Erreur API /api/sessions:', err);
    res.status(500).json({ ok: false, error: err.message || err });
  }
});

router.get('/api/active', async (req, res) => {
  try {
    console.log('✅ API /api/active appelée');
    const pairModule = require('./pair');
    const activeSockets = pairModule.activeSockets;
    const active = activeSockets ? Array.from(activeSockets.keys()) : [];
    res.json({ ok: true, active, count: active.length });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || err });
  }
});

router.post('/api/session/delete', async (req, res) => {
  try {
    const { number } = req.body;
    if (!number) return res.status(400).json({ ok: false, error: 'number required' });

    const sanitized = ('' + number).replace(/[^0-9]/g, '');
    console.log(`Suppression de la session ${sanitized}`);

    // Fèmen sesyon an pou vre si l aktif, pou l pa rete "konekte" apre delete a
    const pairModule = require('./pair');
    const activeSockets = pairModule.activeSockets;
    const running = activeSockets ? activeSockets.get(sanitized) : null;
    if (running) {
      try { if (typeof running.logout === 'function') await running.logout().catch(() => {}); } catch (e) {}
      try { running.ws?.close(); } catch (e) {}
      activeSockets.delete(sanitized);
    }

    await removeSessionFromMongo(sanitized);
    await removeNumberFromMongo(sanitized);

    res.json({ ok: true, message: `Session ${sanitized} removed` });
  } catch (err) {
    console.error('❌ Erreur API /api/session/delete:', err);
    res.status(500).json({ ok: false, error: err.message || err });
  }
});

router.get('/api/newsletters', async (req, res) => {
  try {
    console.log('✅ API /api/newsletters appelée');
    const docs = await listNewslettersFromMongo();
    const list = (docs || []).map(d => ({ jid: d.jid, emojis: d.emojis || [] }));
    res.json({ ok: true, list });
  } catch (err) {
    console.error('❌ Erreur API /api/newsletters:', err);
    res.status(500).json({ ok: false, error: err.message || err });
  }
});

router.get('/api/admins', async (req, res) => {
  try {
    console.log('✅ API /api/admins appelée');
    const list = await loadAdminsFromMongo();
    res.json({ ok: true, list: list || [] });
  } catch (err) {
    console.error('❌ Erreur API /api/admins:', err);
    res.status(500).json({ ok: false, error: err.message || err });
  }
});

router.get('/api/session/config', async (req, res) => {
  const { number } = req.query;
  if (!number) return res.status(400).json({ ok: false, error: 'Number required' });
  
  console.log('✅ API /api/session/config appelée pour:', number);
  res.json({ ok: true, config: {} });
});

// ========== 2. ENSUITE LES FICHIERS STATIQUES ==========
router.use('/dashboard/static', express.static(path.join(process.cwd(), 'dashboard_static')));

// ========== 3. ENFIN LES PAGES HTML ==========
router.get('/dashboard', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'dashboard_static', 'index.html'));
});

router.get('/dashboard/newsletters', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'dashboard_static', 'newsletters.html'));
});

router.get('/dashboard/newsletter-add', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'dashboard_static', 'newsletter-add.html'));
});

router.get('/dashboard/newsletter-remove', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'dashboard_static', 'newsletter-remove.html'));
});

router.get('/dashboard/admins', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'dashboard_static', 'admins.html'));
});

router.get('/dashboard/admin-add', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'dashboard_static', 'admin-add.html'));
});

router.get('/dashboard/admin-remove', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'dashboard_static', 'admin-remove.html'));
});

router.get('/dashboard/sessions', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'dashboard_static', 'sessions.html'));
});

router.get('/dashboard/session-connect', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'dashboard_static', 'session-connect.html'));
});

router.get('/dashboard/session-config', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'dashboard_static', 'session-config.html'));
});

router.get('/dashboard/session-about', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'dashboard_static', 'session-about.html'));
});

router.get('/dashboard/active', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'dashboard_static', 'active.html'));
});

router.get('/dashboard/connect-all', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'dashboard_static', 'connect-all.html'));
});

router.get('/dashboard/reconnect', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'dashboard_static', 'reconnect.html'));
});

module.exports = router;
