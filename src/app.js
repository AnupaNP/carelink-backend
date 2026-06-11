require('dotenv').config();
require('express-async-errors');

const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const elderRoutes = require('./routes/elders');
const scheduleRoutes = require('./routes/schedules');
const callRoutes = require('./routes/calls');
const alertRoutes = require('./routes/alerts');
const insightsRoutes = require('./routes/insights');
const reportsRoutes = require('./routes/reports');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// Middleware
app.use(cors({ origin: '*', methods: ['GET','POST','PUT','PATCH','DELETE'], allowedHeaders: ['Content-Type','Authorization'] }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve elder photos as static files
app.use('/public', express.static(path.join(__dirname, '../public')));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'CareLink API', version: '1.0.0', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/elders', elderRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/insights', insightsRoutes);
app.use('/api/reports', reportsRoutes);

// 404
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

// Global error handler
app.use(errorHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🏥 CareLink API running on port ${PORT}`);
  console.log(`📡 Health: http://localhost:${PORT}/health\n`);
});

module.exports = app;
