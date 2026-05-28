'use strict';

const express = require('express');
const path = require('path');

const { loadConfig, ConfigError, getSafeConfigForLogging } = require('./config');
const { StateRepository } = require('./repository/stateRepository');
const { AIEngine } = require('./services/aiEngine');
const MessageDispatcher = require('./services/messageDispatcher');
const { WebhookController } = require('./controllers/webhookController');
const { HandoffController } = require('./controllers/handoffController');
const { DashboardController } = require('./controllers/dashboardController');

// --- Load Configuration ---
let config;
try {
  config = loadConfig();
} catch (error) {
  if (error instanceof ConfigError) {
    console.error('[Server] Configuration error:', error.message);
  } else {
    console.error('[Server] Unexpected error loading configuration:', error.message);
  }
  process.exit(1);
}

// --- Initialize State Repository ---
const stateRepository = new StateRepository({
  filePath: config.storage.filePath,
  retentionHours: config.storage.retentionHours,
  maxMessagesPerConversation: config.storage.maxMessagesPerConversation
});

// --- Initialize Services ---
const messageDispatcher = new MessageDispatcher(config);
const aiEngine = new AIEngine(config, stateRepository);

// --- Initialize Controllers ---
const handoffController = new HandoffController(config, stateRepository, messageDispatcher);
const webhookController = new WebhookController(config, stateRepository, aiEngine, handoffController, messageDispatcher);
const dashboardController = new DashboardController(stateRepository, handoffController);

// --- Create Express App ---
const app = express();

// Middleware
app.use(express.json());

// Serve static dashboard files from src/public/
app.use(express.static(path.join(__dirname, 'public')));

// --- Register Routes ---

// Webhook endpoint
app.post('/webhook', (req, res) => webhookController.handleWebhook(req, res));

// Health endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', envLoaded: true });
});

// Dashboard API routes
app.get('/api/conversations', (req, res) => dashboardController.getConversations(req, res));
app.post('/api/conversations/:phone/pause', (req, res) => dashboardController.pauseConversation(req, res));
app.post('/api/conversations/:phone/resume', (req, res) => dashboardController.resumeConversation(req, res));

// --- Start Server ---
async function start() {
  // Load persisted state from disk
  await stateRepository.loadFromDisk();

  // Start periodic cleanup interval
  stateRepository.startCleanupInterval();

  const port = config.server.port;
  app.listen(port, () => {
    console.log(`[Server] WhatsApp AI Bot running on port ${port}`);
    console.log('[Server] Configuration loaded:', JSON.stringify(getSafeConfigForLogging(config)));
  });
}

start().catch(error => {
  console.error('[Server] Failed to start:', error.message);
  process.exit(1);
});

module.exports = app;
