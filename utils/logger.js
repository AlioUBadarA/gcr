const isDev = process.env.NODE_ENV !== 'production';

const C = {
  debug: '\x1b[36m', info: '\x1b[32m', warn: '\x1b[33m', error: '\x1b[31m',
  dim: '\x1b[2m', bold: '\x1b[1m', reset: '\x1b[0m',
};

function ts() { return new Date().toISOString(); }

function fmt(level, message, meta) {
  const t = ts();
  if (!isDev) {
    return JSON.stringify({ ts: t, level, message, ...flatMeta(meta) });
  }
  const color = C[level] || '';
  const metaStr = meta && Object.keys(meta).length ? ' ' + formatMeta(meta) : '';
  return `${C.dim}${t}${C.reset} ${color}${C.bold}[${level.toUpperCase()}]${C.reset} ${message}${metaStr}`;
}

function flatMeta(meta) {
  if (!meta) return {};
  if (meta.err instanceof Error) {
    return { ...meta, stack: meta.err.stack, err: meta.err.message };
  }
  return meta;
}

function formatMeta(meta) {
  const m = flatMeta(meta);
  // In dev, print stack on new lines for readability
  const { stack, ...rest } = m;
  const parts = Object.entries(rest)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${C.dim}${k}${C.reset}=${typeof v === 'object' ? JSON.stringify(v) : v}`);
  if (stack) parts.push(`\n${C.dim}${stack}${C.reset}`);
  return parts.join(' ');
}

const logger = {
  debug(message, meta) {
    if (isDev) process.stdout.write(fmt('debug', message, meta) + '\n');
  },
  info(message, meta) {
    process.stdout.write(fmt('info', message, meta) + '\n');
  },
  warn(message, meta) {
    process.stderr.write(fmt('warn', message, meta) + '\n');
  },
  error(message, meta) {
    process.stderr.write(fmt('error', message, meta) + '\n');
  },
};

// Middleware Express : log chaque requête HTTP avec méthode, route, statut, durée, user
logger.httpMiddleware = function(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const status = res.statusCode;
    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
    const meta = {
      status,
      ms,
      ip: req.ip,
      userId: req.userId || null,
      role: req.userRole || null,
    };
    // N'inclure query que si non vide, pour ne pas polluer les logs
    const q = req.query && Object.keys(req.query).length ? req.query : null;
    if (q) meta.query = q;
    logger[level](`${req.method} ${req.path}`, meta);
  });
  next();
};

module.exports = logger;
