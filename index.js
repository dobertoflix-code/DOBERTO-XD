const express = require('express');
const path = require('path');
const bodyParser = require("body-parser");
const app = express();
const PORT = process.env.PORT || 2015;

let code = require('./pair');

require('events').EventEmitter.defaultMaxListeners = 500;

// Middleware
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Routes
app.use('/code', code);

// Paj pairing
app.get('/pair', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'pair.html'));
});

// Paj prensipal
app.get('/', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'main.html'));
});

// Lanse sèvè a
app.listen(PORT, () => {
  console.log(`
╔════════════════════════════╗
║     DOBERTO-XD Bot Server  ║
╠════════════════════════════╣
║  Server running on:        ║
║  http://localhost:${PORT}       ║
║                            ║
║  Pairing:                  ║
║  http://localhost:${PORT}/pair  ║
╚════════════════════════════╝
`);
});

module.exports = app;
