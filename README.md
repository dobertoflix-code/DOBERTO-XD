# DOBERTO-XD V2
This is Doberto x Tech Bot Created By Doberto 2026 The best whatsapp Bot
gr<div align="center">
<h1 style="font-family:'Orbitron', monospace; color:#00ffea; animation:scroll 8s linear infinite; white-space:nowrap;">
DOBERTO-XD V2
</h1>

<img src="https://i.ibb.co/GQ0pdH2t/IMG-20260504-WA0032.jpg" width="160" style="border-radius:20px; box-shadow:0 0 40px #00ffea;" />

Base complete et anonymisee du bot WhatsApp multi-session base sur Express, MongoDB et Baileys.

## Fonctions conservees

- Serveur Express avec pages `/`, `/pair`, `/delete` et dashboard `/dashboard`.
- Pairing WhatsApp multi-session.
- Stockage MongoDB des sessions, numeros, admins, newsletters et configs.
- Commandes de base : `ping`, `menu`, `help`, `owner`, `jid`, `code`.
- Commandes groupe : `tagall`, `hidetag`, `kick`, `add`, `promote`, `demote`, `mute`, `unmute`, `leave`, `listadmin`, `acceptall`, `revokeall`.
- Modules : anti-delete, anti-link, welcome/goodbye, stickers, upload URL, statut, traduction, telechargement medias, config par session.

## Installation

```bash
npm install
cp .env.example .env
# remplir MONGO_URI, OWNER_NUMBER et ADMIN_PASS
npm start
```

## Configuration minimale

- `MONGO_URI` est obligatoire pour les sessions et fonctions persistantes.
- `OWNER_NUMBER` doit etre le numero proprietaire sans `+`.
- `ADMIN_PASS` protege les routes admin du dashboard.
- Le prefixe par defaut est `.`.

## Premiere utilisation

1. Lance le serveur avec `npm start`.
2. Ouvre `http://localhost:2001/pair`.
3. Entre ton numero WhatsApp pour generer le pairing code.
4. Apres connexion, teste `.ping` puis `.menu`.

## Notes

Cette base a ete anonymisee : noms, branding, numeros, liens, images, mots de passe et URI Mongo d'origine ont ete remplaces par des valeurs generiques.

