const buckets = new Map();

// Límite liviano por IP y ruta. En despliegues con varias instancias se debe
// complementar con el límite del proveedor; aquí se evita abuso accidental
// sin incorporar estado externo ni una dependencia adicional.
export const rateLimit = ({ windowMs = 15 * 60_000, max = 10 } = {}) => (req, res, next) => {
  const now = Date.now();
  if (buckets.size > 5000) for (const [bucketKey, value] of buckets) if (value.resetAt <= now) buckets.delete(bucketKey);
  const key = `${req.ip || req.socket?.remoteAddress || 'unknown'}:${req.baseUrl}${req.path}`;
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return next();
  }
  current.count += 1;
  if (current.count > max) {
    res.set('Retry-After', String(Math.ceil((current.resetAt - now) / 1000)));
    return res.status(429).json({ message: 'Demasiados intentos. Espera un momento e inténtalo de nuevo.' });
  }
  next();
};

export default rateLimit;
