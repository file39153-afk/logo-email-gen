const express = require('express');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const sqlite3 = require('sqlite3').verbose();
const session = require('express-session');

const app = express();

// Set view engine
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: false }));

// Configure session middleware
app.use(session({
  secret: 'your-secret-key', // change this
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Initialize SQLite DB
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

// Middleware to set dynamic baseUrl for EJS
app.use((req, res, next) => {
  const protocol = req.protocol;
  const host = req.get('host');
  res.locals.baseUrl = `${protocol}://${host}`;
  next();
});

// Protect routes
const requireLogin = (req, res, next) => {
  if (req.session && req.session.loggedIn) {
    next();
  } else {
    res.redirect('/login');
  }
};

// --- Pixel load route: logs the load and serves the image ---
app.get('/logo/:id', (req, res) => {
  const pixelId = req.params.id;

  // Log request info
  console.log(`Pixel load request for ID: ${pixelId}`);
  console.log(`IP: ${req.ip}`);
  console.log(`User-Agent: ${req.headers['user-agent']}`);

  // Check if pixel exists
  const selectPixel = 'SELECT * FROM pixels WHERE id = ?';
  db.get(selectPixel, [pixelId], (err, pixel) => {
    if (err) {
      console.error('Error looking up pixel:', err);
      return res.status(500).send('Server error.');
    }
    if (!pixel) {
      console.warn(`Pixel not found: ${pixelId}`);
      return res.status(404).send('Pixel not found');
    }

    // Prepare log data
    const time = new Date().toISOString();
    const ip = req.ip;
    const userAgent = req.headers['user-agent'] || '';

    // Log load in console
    console.log(`Logging pixel load: pixelId=${pixelId}, time=${time}, ip=${ip}, userAgent=${userAgent}`);

    // Insert log into DB
    const insertLog = 'INSERT INTO logs (pixelId, time, ip, userAgent) VALUES (?, ?, ?, ?)';
    db.run(insertLog, [pixelId, time, ip, userAgent], function (err) {
      if (err) {
        console.error('Error inserting log into DB:', err);
      } else {
        console.log(`Logged load with log ID: ${this.lastID}`);
      }

      // Send the pixel image
      res.sendFile(path.join(__dirname, 'public', 'images', 'pixel.png'), (err) => {
        if (err) {
          console.error('Error sending pixel.png:', err);
        }
      });
    });
  });
});

// Start server
const PORT = process.env.PORT || 3300;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
