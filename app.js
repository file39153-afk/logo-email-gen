const express = require('express');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { Client } = require('pg');

const app = express();
const session = require('express-session');
const SECRET_KEY = process.env.SECRET_KEY; // Define your secret key

app.use(session({
  secret: SECRET_KEY,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // set to true if deploying with HTTPS
}));

// Set view engine
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: false }));

// Replace with your PostgreSQL connection info
const db = new Client({
  host: 'atw-logo.onrender.com',     // your render host
  port: 5432,                       // your port
  database: 'logo02',         // your database name
  user: 'logo02_user',            // your username
  password: 'cmZg6T5afl8MgHArMMPnDL106lqbhrCQ'         // your password
});

db.connect()
  .then(() => {
    console.log('Connected to PostgreSQL database.');

    // Create tables if they don't exist
    return Promise.all([
      db.query(`
        CREATE TABLE IF NOT EXISTS pixels (
          id TEXT PRIMARY KEY,
          name TEXT,
          createdAt TEXT
        )
      `),
      db.query(`
        CREATE TABLE IF NOT EXISTS logs (
          id SERIAL PRIMARY KEY,
          pixelId TEXT,
          time TEXT,
          ip TEXT,
          userAgent TEXT
        )
      `)
    ]);
  })
  .catch(err => console.error('DB connection error:', err));

// Serve static files from /public
app.use(express.static(path.join(__dirname, 'public')));

// Middleware to set dynamic baseUrl for EJS templates
app.use((req, res, next) => {
  const protocol = req.protocol;
  const host = req.get('host');
  res.locals.baseUrl = `${protocol}://${host}`;
  next();
});

// Middleware to protect routes
const requireLogin = (req, res, next) => {
  if (req.session && req.session.loggedIn) {
    next();
  } else {
    res.redirect('/login');
  }
};

// --------- Login Routes ---------
app.get('/login', (req, res) => {
  res.render('login');
});

app.post('/login', (req, res) => {
  const { username: inputUser, password: inputPass } = req.body;
  const envUser = process.env.ADMIN_USERNAME;
  const envPass = process.env.ADMIN_PASSWORD;
  if (inputUser === envUser && inputPass === envPass) {
    req.session.loggedIn = true;
    res.redirect('/');
  } else {
    res.render('login', { error: 'Invalid username or password' });
  }
});

app.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

// --------- Main site routes ---------
// List pixels dashboard (protected)
app.get('/', requireLogin, (req, res) => {
  db.query('SELECT * FROM pixels ORDER BY createdAt DESC')
    .then(result => {
      res.render('index', { pixels: result.rows });
    })
    .catch(err => {
      console.error('Error querying pixels:', err);
      res.status(500).send('Error querying pixels.');
    });
});

// API to create a new pixel (logo)
app.post('/api/create', (req, res) => {
  const { name } = req.body;
  const pixelId = 'pixel_' + Math.random().toString(36).slice(2, 10);
  const createdAt = new Date().toISOString();

  db.query('INSERT INTO pixels (id, name, createdAt) VALUES ($1, $2, $3)', [pixelId, name || `Pixel-${pixelId}`, createdAt])
    .then(() => {
      const url = `${res.locals.baseUrl}/logo/${pixelId}.png`;
      res.json({ success: true, id: pixelId, url });
    })
    .catch(err => {
      console.error('Error creating pixel:', err);
      res.status(500).json({ success: false, error: 'Error creating pixel' });
    });
});

// Route to serve pixel image and log load
app.get('/logo/:id.png', (req, res) => {
  const pixelId = req.params.id;

  // Check if pixel exists
  db.query('SELECT * FROM pixels WHERE id = $1', [pixelId])
    .then(result => {
      const pixel = result.rows[0];
      if (!pixel) {
        console.warn(`Pixel not found: ${pixelId}`);
        return res.status(404).send('Pixel not found');
      }

      // Log load event
      const now = new Date().toISOString();
      const ip = req.ip;
      const userAgent = req.headers['user-agent'] || '';

      db.query(
        'INSERT INTO logs (pixelId, time, ip, userAgent) VALUES ($1, $2, $3, $4)',
        [pixelId, now, ip, userAgent]
      ).catch(err => console.error('Error inserting log:', err));

      // Serve static pixel image
      res.sendFile(path.join(__dirname, 'public', 'images', 'pixel.png'));
    })
    .catch(err => {
      console.error('DB query error:', err);
      res.status(500).send('Server error.');
    });
});

// View logs for a specific pixel (protected)
app.get('/logs/:id', requireLogin, (req, res) => {
  const pixelId = req.params.id;
  db.query('SELECT * FROM pixels WHERE id = $1', [pixelId])
    .then(result => {
      if (result.rows.length === 0) {
        return res.status(404).send('Pixel not found');
      }
      // Fetch logs
      db.query('SELECT * FROM logs WHERE pixelId = $1 ORDER BY id DESC', [pixelId])
        .then(logsResult => {
          res.render('logs', { pixel: result.rows[0], logs: logsResult.rows });
        })
        .catch(err => {
          console.error('Error fetching logs:', err);
          res.status(500).send('Error fetching logs');
        });
    })
    .catch(err => {
      console.error('Error retrieving pixel:', err);
      res.status(500).send('Server error');
    });
});

// Start server
const PORT = process.env.PORT || 3300;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
