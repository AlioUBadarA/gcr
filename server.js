require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { initSchema, runMigrations } = require('./db/pool');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Securite ──────────────────────────────────────────────────
app.set('trust proxy', 1); // Render passe par un reverse proxy
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  methods: ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
  allowedHeaders: ['Content-Type','Authorization'],
}));

// Rate limiting global
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Trop de requetes. Reessayez dans 15 minutes.' }
}));

// Rate limiting strict pour auth
app.use('/api/auth', rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Trop de tentatives de connexion. Reessayez dans 15 minutes.' }
}));

app.use(express.json({ limit: '1mb' }));

// ── Health check ──────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '1.0.0' });
});

// ── Routes ────────────────────────────────────────────────────
app.use('/api/auth',        require('./routes/auth'));
app.use('/api/clients',     require('./routes/clients'));
app.use('/api/ventes',      require('./routes/ventes'));
app.use('/api/pilotage',    require('./routes/pilotage'));
app.use('/api/dashboard',   require('./routes/dashboard'));
app.use('/api/admin',       require('./routes/admin'));
app.use('/api/equipe',      require('./routes/equipe'));
app.use('/api/forecast',    require('./routes/forecast'));
app.use('/api/prospection', require('./routes/prospection'));
app.use('/api/actions',     require('./routes/actions'));
app.use('/api/rentabilite', require('./routes/rentabilite'));
app.use('/api/emplois',     require('./routes/emplois'));
app.use('/api/contrats',    require('./routes/contrats'));
app.use('/api/managers',    require('./routes/managers'));
app.use('/api/produits',    require('./routes/produits'));
app.use('/api/activites',   require('./routes/activites'));
app.use('/api/journal',     require('./routes/journal'));

// ── 404 ───────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: `Route non trouvee : ${req.method} ${req.path}` });
});

// ── Erreurs globales ──────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Erreur non geree:', err.message);
  res.status(500).json({ error: 'Erreur serveur interne' });
});

// ── Demarrage ─────────────────────────────────────────────────
async function start() {
  if (!process.env.DATABASE_URL) {
    console.error('ERREUR: DATABASE_URL manquant dans les variables d\'environnement');
    process.exit(1);
  }
  if (!process.env.JWT_SECRET) {
    console.error('ERREUR: JWT_SECRET manquant dans les variables d\'environnement');
    process.exit(1);
  }
  try {
    await initSchema();
    await runMigrations();
    app.listen(PORT, () => {
      console.log(`PFS Backend demarre sur le port ${PORT}`);
      console.log(`Health check : http://localhost:${PORT}/health`);
    });
  } catch (err) {
    console.error('Echec du demarrage:', err.message);
    process.exit(1);
  }
}

start();
