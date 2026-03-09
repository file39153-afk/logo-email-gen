const express = require('express');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { Client } = require('pg');
const session = require('express-session');
const fetch = require('node-fetch'); // Make sure to install: npm install node-fetch

const app = express();

// Set view engine
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: false }));

const envKey = process.env.SECRET_KEY;

app.use(session({
  secret: envKey,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // only over HTTPS
    httpOnly: true,
    sameSite: 'strict' // or 'lax'
  }
}));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// PostgreSQL client setup
const db = new Client({
  connectionString: process.env.DATABASE_URL,
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
          userAgent TEXT,
          city TEXT,
          region TEXT,
          country TEXT
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
  const createdAt = new Date().toISOString();

  db.query('INSERT INTO pixels (id, name, createdAt) VALUES ($1, $2, $3)', [pixelId, name || `Pixel-${pixelId.slice(0,8)}`, createdAt])
    .then(() => {
      res.redirect('/');
    })
    .catch(err => {
      console.error('Error creating pixel:', err);
      res.status(500).send('Error creating pixel.');
    });
});

// Serve pixel image and log load with location
app.get('/logo/:id.png', async (req, res) => {
  const pixelId = req.params.id;
  console.log(`Loading pixel image for ID: ${pixelId}`);

  const ip = getClientIp(req);
  const userAgent = req.headers['user-agent'] || '';

  const now = new Date().toISOString();

  // Fetch location info from ipinfo.io
  let city = null, region = null, country = null;
  try {
    const token = process.env.IPINFO_TOKEN; // Set in environment variables
    const response = await fetch(`https://ipinfo.io/${ip}/json?token=${token}`);
    if (response.ok) {
      const locationData = await response.json();
      city = locationData.city || null;
      region = locationData.region || null;
      country = locationData.country || null;
    } else {
      console.warn('Failed to fetch location info:', response.status);
    }
  } catch (err) {
    console.error('Error fetching IP info:', err);
  }

  // Log the load event with location info
  db.query(
    'INSERT INTO logs (pixelId, time, ip, userAgent, city, region, country) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [pixelId, now, ip, userAgent, city, region, country]
  ).catch(err => {
    console.error('Error inserting log with location:', err);
  });

  // Check if pixel exists
  db.query('SELECT * FROM pixels WHERE id = $1', [pixelId])
    .then(result => {
      if (result.rows.length === 0) {
        console.warn(`Pixel not found: ${pixelId}`);
        return res.status(404).send('Pixel not found');
      }
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
