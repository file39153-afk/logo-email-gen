const express = require('express');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { Client } = require('pg');
const session = require('express-session');

const app = express();

// Set view engine
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: false }));

const envKey = process.env.SECRET_KEY;

// Configure session middleware
app.use(session({
  secret: envKey,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false }
}));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// PostgreSQL client setup
const db = new Client({
  host: 'dpg-d6mjpc4hg0os739l80l0-a', // your host
  port: 5432,
  database: 'logo02_tyxs',
  user: 'logo02_tyxs_user',
  password: '38yaB9rM2tsUi49MuR0pNomBiKzH3EeQ'
});

// Connect to PostgreSQL
db.connect()
  .then(() => {
    console.log('Connected to PostgreSQL database.');

    // Create tables if not exist
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

// Helper to get client IP
const getClientIp = (req) => {
  return req.headers['x-forwarded-for']?.split(',')[0] || req.connection.remoteAddress;
};

// Middleware for setting base URL
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

// --------- Main routes ---------

// Dashboard
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

// Create pixel
app.post('/create', requireLogin, (req, res) => {
  const { name } = req.body;
  const pixelId = uuidv4();
  const createdat = new Date().toISOString();


  db.query('INSERT INTO pixels (id, name, createdat) VALUES ($1, $2, $3)', [pixelId, name || `Pixel-${pixelId.slice(0,8)}`, createdat])
    .then(() => {
      res.redirect('/');
    })
    .catch(err => {
      console.error('Error creating pixel:', err);
      res.status(500).send('Error creating pixel.');
    });
});

app.get('/logo/:id.png', (req, res) => {
  const pixelId = req.params.id;
  console.log(`Loading pixel image for ID: ${pixelId}`);

  const ip = getClientIp(req);
  const userAgent = req.headers['user-agent'] || '';

  // Declare and assign 'now' before any database queries
  const now = new Date().toISOString();
  console.log('Captured User-Agent:', userAgent);

  // Log the load event
  db.query('INSERT INTO logs (pixelId, time, ip, userAgent) VALUES ($1, $2, $3, $4)', [pixelId, now, ip, userAgent])
    .catch(err => {
      console.error('Error inserting log:', err);
    });

  // Check if pixel exists
  db.query('SELECT * FROM pixels WHERE id = $1', [pixelId])
    .then(result => {
      if (result.rows.length === 0) {
        console.warn(`Pixel not found: ${pixelId}`);
        return res.status(404).send('Pixel not found');
      }
      // Send pixel image
      res.sendFile(path.join(__dirname, 'public', 'images', 'pixel.png'));
    })
    .catch(err => {
      console.error('Error retrieving pixel:', err);
      res.status(500).send('Server error');
    });
});
// Route to delete a pixel by ID
app.post('/delete/:id', requireLogin, (req, res) => {
  const pixelId = req.params.id;
  // Delete associated logs first (optional)
  db.query('DELETE FROM logs WHERE pixelId = $1', [pixelId])
    .then(() => {
      // Delete the pixel
      return db.query('DELETE FROM pixels WHERE id = $1', [pixelId]);
    })
    .then(() => {
      res.redirect('/');
    })
    .catch(err => {
      console.error('Error deleting pixel:', err);
      res.status(500).send('Error deleting pixel');
    });
});
// View logs for a pixel
app.get('/logs/:id', requireLogin, (req, res) => {
  const pixelId = req.params.id;
  db.query('SELECT * FROM pixels WHERE id = $1', [pixelId])
    .then(result => {
      if (result.rows.length === 0) {
        return res.status(404).send('Pixel not found');
      }
      db.query('SELECT * FROM logs WHERE pixelId = $1 ORDER BY time DESC', [pixelId])
        .then(logsResult => {
          res.render('logs', { pixel: result.rows[0], logs: logsResult.rows });
        })
        .catch(err => {
          console.error('Error retrieving logs:', err);
          res.status(500).send('Error retrieving logs');
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
