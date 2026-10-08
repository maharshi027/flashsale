const express = require('express');
const routes = require('./routes');
const { errorHandler } = require('./middleware/errorHandler');
const config = require('./config');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10kb' }));

if (config.env !== 'test') {
  app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms`);
    });
    next();
  });
}

app.use(routes);
app.use((_req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } }));
app.use(errorHandler);

module.exports = app;
