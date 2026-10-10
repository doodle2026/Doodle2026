const path = require('path');
const { openDb } = require('./db');
const { createApp } = require('./app');

const PORT = process.env.PORT || 3000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, '..', 'data', 'doodle.db');
createApp(openDb(DB_FILE)).listen(PORT, () => console.log(`Lytter på http://localhost:${PORT}`));
