// app.js
const express = require('express');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const sqlite3 = require('sqlite3').verbose();

const app = express();
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: false }));

// 1) Serve static files from /public
app.use(express.static(path.join(__dirname, 'public')));

// 2) Initialize the SQLite DB
const db = new sqlite3.Database(path.join(__dirname, 'logo.db'), (err) => {
  if (err) {
    console.error('Error opening SQLite database:', err);
  } else {
    console.log('Connected to SQLite database.');
    db.run(`
      CREATE TABLE IF NOT EXISTS pixels (
        id TEXT PRIMARY KEY,
        name TEXT,
        createdAt TEXT
      )
    `);
    db.run(`
      CREATE TABLE IF NOT EXISTS logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pixelId TEXT,
        time TEXT,
        ip TEXT,
        userAgent TEXT
      )
    `);
  }
});

// Middleware to set dynamic baseUrl for EJS templates
app.use((req, res, next) => {
  const protocol = req.protocol; // 'http' or 'https'
  const host = req.get('host'); // e.g. 'localhost:3000'
  res.locals.baseUrl = `${protocol}://${host}`;
  next();
});

// 3) Dashboard route: list pixels
app.get('/', (req, res) => {
  const query = 'SELECT * FROM pixels ORDER BY createdAt DESC';
  db.all(query, [], (err, pixels) => {
    if (err) {
      return res.status(500).send('Error querying pixels.');
    }
    res.render('index', { pixels });
  });
});

// 4) Create a new pixel
app.post('/create', (req, res) => {
  const { name } = req.body;
  const pixelId = uuidv4();
  const createdAt = new Date().toISOString();

  const insertPixel = 'INSERT INTO pixels (id, name, createdAt) VALUES (?, ?, ?)';
  db.run(insertPixel, [pixelId, name || `Pixel-${pixelId.slice(0, 8)}`, createdAt], (err) => {
    if (err) {
      console.error('Error inserting pixel:', err);
      return res.status(500).send('Error creating pixel.');
    }
    res.redirect('/');
  });
});


// To this:
app.get('/logo/:id', (req, res) => {
  const pixelId = req.params.id;

  // Check if pixel exists
  const selectPixel = 'SELECT * FROM pixels WHERE id = ?';
  db.get(selectPixel, [pixelId], (err, pixel) => {
    if (err) {
      console.error('Error looking up pixel:', err);
      return res.status(500).send('Error retrieving pixel.');
    }
    if (!pixel) {
      return res.status(404).send('Pixel not found');
    }

    // Log open event
    const time = new Date().toISOString();
    const ip = req.ip;
    const userAgent = req.headers['user-agent'] || '';

    const insertLog = 'INSERT INTO logs (pixelId, time, ip, userAgent) VALUES (?, ?, ?, ?)';
    db.run(insertLog, [pixelId, time, ip, userAgent], (logErr) => {
      if (logErr) {
        console.error('Error inserting log:', logErr);
      }
      // Send pixel.png
      res.sendFile(path.join(__dirname, 'public', 'images', 'pixel.png'), (fsErr) => {
        if (fsErr) {
          console.error('Error sending pixel.png:', fsErr);
          res.status(fsErr.status || 500).end();
        }
      });
    });
  });
});

// 6) View logs for a specific pixel
app.get('/logs/:id', (req, res) => {
  const pixelId = req.params.id;

  const selectPixel = 'SELECT * FROM pixels WHERE id = ?';
  db.get(selectPixel, [pixelId], (err, pixel) => {
    if (err) {
      console.error('Error retrieving pixel:', err);
      return res.status(500).send('Error retrieving pixel.');
    }
    if (!pixel) {
      return res.status(404).send('Pixel not found');
    }

    const selectLogs = 'SELECT * FROM logs WHERE pixelId = ? ORDER BY time DESC';
    db.all(selectLogs, [pixelId], (logsErr, logs) => {
      if (logsErr) {
        console.error('Error retrieving logs:', logsErr);
        return res.status(500).send('Error retrieving logs.');
      }
      res.render('logs', { pixel, logs });
    });
  });
});

// 7) Start server
const PORT = process.env.PORT || 3300;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
