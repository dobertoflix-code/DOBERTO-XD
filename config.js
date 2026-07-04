module.exports = {
    // ⚠️ CHANJE MODPAS SA A anvan w mete bot la an pwodiksyon !
    // Pi bon fason: pa mete l isit, mete l kòm variable d'environnement
    // DASHBOARD_PASSWORD sou Render/hosting ou a — sa evite l parèt nan GitHub.
    DASHBOARD_USER: 'admin',
    DASHBOARD_PASSWORD: 'CHANJE_MWEN_MMS_PA',
    AUTO_VIEW_STATUS: 'true',
    AUTO_LIKE_STATUS: 'true',
    AUTO_RECORDING: 'true',
    AUTO_LIKE_EMOJI: ['🧩', '🍉', '💜', '🌸', '🪴', '💊', '💫', '🍂', '🌟', '🎋', '😶‍🌫️', '🫀', '🧿', '👀', '🤖', '🚩', '🥰', '🗿', '💜', '💙', '🌝', '🖤', '💚'],
    PREFIX: '.',
    MAX_RETRIES: 3,
    GROUP_INVITE_LINKS: [
        'https://chat.whatsapp.com/BSrXfXLW9y6HEl2LuvGYmr',
        'https://chat.whatsapp.com/Jhfto4qTh6GAEjBOvPyA2w',
    ],
    ADMIN_LIST_PATH: './admin.json',
    IMAGE_PATH: '',
    NEWSLETTER_JID: '120363423792937578@newsletter',
    NEWSLETTER_MESSAGE_ID: '120363405381898232@newsletter',
    OTP_EXPIRY: 300000,
    NEWS_JSON_URL: '',
    BOT_NAME: 'DOBERTO-XD',
    OWNER_NAME: 'Dev Doberto',
    OWNER_NUMBER: '50935878442,50939492644',
    BOT_VERSION: '5.0.0',
    // 🤖 Kle(y) API pou komand .ai — pran kle GRATIS sou https://aistudio.google.com/apikey
    // Pi bon fason: mete yo kòm variable d'environnement sou Render/hosting ou a.
    // Ou ka mete jiska 3 kle (oswa plis) — si youn rive nan limit li (quota),
    // bot la eseye pwochen kle a otomatikman san moun pa wè diferans.
    GEMINI_API_KEYS: [
      process.env.GEMINI_API_KEY || '',
      process.env.GEMINI_API_KEY_2 || '',
      process.env.GEMINI_API_KEY_3 || '',
    ].filter(k => k && k.trim() !== ''),
    BOT_FOOTER: '> DOBERTO-XD',
    CHANNEL_LINK: 'https://whatsapp.com/channel/0029VbBulmY0LKZLRooVdU0i',
};
