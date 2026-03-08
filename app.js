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
  secret: 'your-secret-key', // change this to a strong secret
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // set to true if using HTTPS
}));

// Serve static files from /public
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
  const { username, password } = req.body;
  const validUsername = 'admin'; // change as needed
  const validPassword = 'password123'; // change as needed

  if (username === validUsername && password === validPassword) {
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

// Dashboard route: list pixels (protected)
app.get('/', requireLogin, (req, res) => {
  const query = 'SELECT * FROM pixels ORDER BY createdAt DESC';
  db.all(query, [], (err, pixels) => {
    if (err) {
      return res.status(500).send('Error querying pixels.');
    }
    res.render('index', { pixels });
  });
});

// Create a new pixel
app.post('/create', requireLogin, (req, res) => {
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

// --------- Image load route with logging ---------
app.get('/logo/:id.png', (req, res) => {
  const pixelId = req.params.id;

  // Log request info for debugging
  console.log(`Loading pixel image for ID: ${pixelId}`);
  console.log(`Request IP: ${req.ip}`);
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

    // Log load into console
    console.log(`Logging pixel load: pixelId=${pixelId}, time=${time}, ip=${ip}, userAgent=${userAgent}`);

    // Save log into database
    const insertLog = 'INSERT INTO logs (pixelId, time, ip, userAgent) VALUES (?, ?, ?, ?)';
    db.run(insertLog, [pixelId, time, ip, userAgent], function (err) {
      if (err) {
        console.error('Error inserting log into DB:', err);
      } else {
        console.log(`Logged load with log ID: ${this.lastID}`);
      }

      // Send pixel image
      res.sendFile(path.join(__dirname, 'public', 'images', 'pixel.png'), (err) => {
        if (err) {
          console.error('Error sending pixel.png:', err);
        }
      });
    });
  });
});

// View logs for specific pixel (protected)
app.get('/logs/:id', requireLogin, (req, res) => {
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

// --------- Server start ---------
const PORT = process.env.PORT || 3300;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
