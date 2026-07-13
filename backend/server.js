require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const path = require('path');
const pool = require('./config/database');

const authRoutes = require('./routes/auth');
const studentRoutes = require('./routes/student');
const supervisorRoutes = require('./routes/supervisor');
const financeRoutes = require('./routes/finance');
const adminRoutes = require('./routes/admin');
const controlRoutes = require('./routes/control');
const verifyRoutes = require('./routes/verify');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com", "https://api.qrserver.com"],
      styleSrc: ["'self'", "https://fonts.googleapis.com", "'unsafe-inline'"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https://amrattiaewais69-gif.github.io", "https://api.qrserver.com"],
      connectSrc: ["'self'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));

const allowedOrigins = [
  process.env.CORS_ORIGIN,
  'portal.uec.edu.eg',
  'backend-sage-rho-84.vercel.app',
  'http://localhost:3000'
].filter(Boolean);

app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    const clean = origin.replace(/^https?:\/\//, '');
    if (allowedOrigins.some(o => clean === o || clean.endsWith('.' + o))) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));

app.use(compression());

const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Too many requests, please try again later' }
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts, please try again later' }
});

const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { error: 'Too many requests' }
});

app.use('/api/', generalLimiter);
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth/account-login', loginLimiter);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/', (req, res) => {
  res.redirect('/login.html');
});

app.use(express.static(path.join(__dirname, 'public')));

app.use('/api/auth', authRoutes);
app.use('/api/student', studentRoutes);
app.use('/api/supervisor', supervisorRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/control', controlRoutes);
app.use('/api/verify', verifyLimiter, verifyRoutes);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('*', (req, res) => {
  if (req.path.includes('.')) return res.status(404).send('Not found');
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`UEC Portal running on port ${PORT}`);
});
