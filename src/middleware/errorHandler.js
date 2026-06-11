function errorHandler(err, req, res, next) {
  console.error('❌ Error:', err.message);

  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({ error: 'Invalid token' });
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({ error: 'Token expired, please login again' });
  }
  if (err.code === '23505') {
    return res.status(409).json({ error: 'Resource already exists (duplicate)' });
  }
  if (err.code === '23503') {
    return res.status(400).json({ error: 'Referenced resource not found' });
  }

  const status = err.statusCode || err.status || 500;
  res.status(status).json({ error: err.message || 'Internal server error' });
}

module.exports = errorHandler;
