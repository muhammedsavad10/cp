const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
require('dotenv').config();

const { initWebSocket } = require('./websocket');
const authRoutes = require('./routes/auth');
const stallRoutes = require('./routes/stall');
const adminRoutes = require('./routes/admin');

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/healthz', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/stall', stallRoutes);
app.use('/api/admin', adminRoutes);

// Serve static frontend build if available
const clientBuildPath = path.join(__dirname, '../client/dist');
app.use(express.static(clientBuildPath));

app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  res.sendFile(path.join(clientBuildPath, 'index.html'), (err) => {
    if (err) {
      res.status(200).send('Cold Payasam Server Running. Frontend build pending.');
    }
  });
});

// Initialize WebSockets
initWebSocket(server);

server.listen(PORT, () => {
  console.log(`Cold Payasam Backend Server running on http://localhost:${PORT} (NODE_ENV: ${process.env.NODE_ENV || 'development'})`);
});

module.exports = server;
