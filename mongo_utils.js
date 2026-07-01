// mongo_utils.js (ajoute ces fonctions au fichier existant)
const { MongoClient, GridFSBucket, ObjectId } = require('mongodb');

let client = null;
let db = null;
let configsCol = null;
let antideleteCol = null;
let gridfsBucket = null;

async function initMongo() {
  if (db && client && client.isConnected && client.isConnected()) return;
  client = new MongoClient(process.env.MONGO_URI || '', {
    useNewUrlParser: true,
    useUnifiedTopology: true
  });
  await client.connect();
  db = client.db(process.env.MONGO_DB || 'basebot_db');
  configsCol = db.collection('configs');
  antideleteCol = db.collection('antidelete_messages');
  gridfsBucket = new GridFSBucket(db, { bucketName: 'antidelete_files' });

  await configsCol.createIndex({ number: 1 }, { unique: true });
  await antideleteCol.createIndex({ sessionId: 1, msgId: 1 }, { unique: true });
}

// GridFS helpers
async function saveMediaToGridFS(sessionId, msgId, buffer, filename = 'file.bin', contentType = 'application/octet-stream') {
  try {
    await initMongo();
    const uploadStream = gridfsBucket.openUploadStream(`${sessionId}_${msgId}_${Date.now()}_${filename}`, {
      metadata: { sessionId: String(sessionId), msgId: String(msgId) },
      contentType
    });
    return new Promise((resolve, reject) => {
      uploadStream.end(buffer, (err, file) => {
        if (err) return reject(err);
        resolve(String(file._id));
      });
    });
  } catch (e) {
    console.error('saveMediaToGridFS', e);
    throw e;
  }
}

async function getMediaFromGridFS(fileId) {
  try {
    await initMongo();
    const _id = new ObjectId(String(fileId));
    const files = await db.collection('antidelete_files.files').findOne({ _id });
    if (!files) return null;
    const downloadStream = gridfsBucket.openDownloadStream(_id);
    const chunks = [];
    return new Promise((resolve, reject) => {
      downloadStream.on('data', (c) => chunks.push(c));
      downloadStream.on('error', (err) => reject(err));
      downloadStream.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({ buffer, contentType: files.contentType || files.metadata?.contentType || 'application/octet-stream', filename: files.filename });
      });
    });
  } catch (e) {
    console.error('getMediaFromGridFS', e);
    return null;
  }
}

async function deleteMediaFromGridFS(fileId) {
  try {
    await initMongo();
    const _id = new ObjectId(String(fileId));
    await gridfsBucket.delete(_id);
  } catch (e) {
    console.error('deleteMediaFromGridFS', e);
  }
}

// Exports (ajoute aux exports existants)
module.exports = {
  initMongo,
  closeMongo,
  getDb,
  configsCol,
  antideleteCol,
  setUserConfigInMongo,
  loadUserConfigFromMongo,
  saveAntideleteMessage,
  getAntideleteMessage,
  deleteAntideleteMessage,
  clearOldMessages,
  clearAllSessionMessages,
  // GridFS
  saveMediaToGridFS,
  getMediaFromGridFS,
  deleteMediaFromGridFS
};