'use strict';

const path = require('path');
const fs = require('fs');

// Load .env file before accessing process.env
require('dotenv').config();

/**
 * Custom error class for configuration validation failures.
 * Contains an array of all validation errors found.
 */
class ConfigError extends Error {
  /**
   * @param {string[]} errors - Array of validation error messages
   */
  constructor(errors) {
    const message = `Configuration validation failed:\n${errors.map(e => `  - ${e}`).join('\n')}`;
    super(message);
    this.name = 'ConfigError';
    this.errors = errors;
  }
}

/**
 * List of environment variable names that contain credentials.
 * These values must NEVER be logged.
 */
const CREDENTIAL_VARS = ['OPENAI_API_KEY', 'ZAPI_TOKEN', 'ZAPI_WEBHOOK_SECRET'];

/**
 * Default system prompt used when neither env var nor config file provides one.
 */
const DEFAULT_SYSTEM_PROMPT = 'You are a helpful WhatsApp assistant.';

/**
 * Path to the fallback system prompt config file.
 */
const SYSTEM_PROMPT_FILE_PATH = path.join(__dirname, '..', '..', 'system-prompt.txt');

/**
 * Checks if a string value is missing or whitespace-only.
 * @param {string|undefined} value
 * @returns {boolean}
 */
function isMissingOrWhitespace(value) {
  return !value || value.trim().length === 0;
}

/**
 * Loads the system prompt from environment variable or fallback config file.
 * @param {string[]} errors - Mutable array to collect validation errors
 * @returns {string} The system prompt text
 */
function loadSystemPrompt(errors) {
  const envPrompt = process.env.SYSTEM_PROMPT;

  if (envPrompt && envPrompt.trim().length > 0) {
    const trimmed = envPrompt.trim();
    if (trimmed.length > 4000) {
      errors.push('SYSTEM_PROMPT exceeds maximum length of 4000 characters');
      return trimmed.substring(0, 4000);
    }
    return trimmed;
  }

  // Fallback to config file
  try {
    if (fs.existsSync(SYSTEM_PROMPT_FILE_PATH)) {
      const fileContent = fs.readFileSync(SYSTEM_PROMPT_FILE_PATH, 'utf-8').trim();
      if (fileContent.length > 0) {
        if (fileContent.length > 4000) {
          errors.push('System prompt from config file exceeds maximum length of 4000 characters');
          return fileContent.substring(0, 4000);
        }
        return fileContent;
      }
    }
  } catch (err) {
    // If file read fails, fall through to default
  }

  return DEFAULT_SYSTEM_PROMPT;
}

/**
 * Loads and validates all configuration from environment variables.
 * Reports ALL validation errors at once rather than failing on the first one.
 *
 * @returns {object} Validated configuration object
 * @throws {ConfigError} If any required variables are missing or invalid
 */
function loadConfig() {
  const errors = [];

  // --- Validate required environment variables ---

  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (isMissingOrWhitespace(openaiApiKey)) {
    errors.push('OPENAI_API_KEY is required and must not be empty or whitespace-only');
  }

  const zapiInstanceId = process.env.ZAPI_INSTANCE_ID;
  if (isMissingOrWhitespace(zapiInstanceId)) {
    errors.push('ZAPI_INSTANCE_ID is required and must not be empty or whitespace-only');
  }

  const zapiToken = process.env.ZAPI_TOKEN;
  if (isMissingOrWhitespace(zapiToken)) {
    errors.push('ZAPI_TOKEN is required and must not be empty or whitespace-only');
  }

  const zapiWebhookSecret = process.env.ZAPI_WEBHOOK_SECRET;
  // ZAPI_WEBHOOK_SECRET is optional — Z-API does not natively provide webhook signature validation

  const handoffTrigger = process.env.HANDOFF_TRIGGER;
  if (isMissingOrWhitespace(handoffTrigger)) {
    errors.push('HANDOFF_TRIGGER is required and must not be empty or whitespace-only');
  } else {
    // Support multiple triggers separated by |
    const triggers = handoffTrigger.split('|').map(t => t.trim()).filter(t => t.length > 0);
    if (triggers.length === 0) {
      errors.push('HANDOFF_TRIGGER must contain at least one valid keyword');
    } else {
      for (const trigger of triggers) {
        if (trigger.length < 2 || trigger.length > 50) {
          errors.push(`HANDOFF_TRIGGER keyword "${trigger}" must be between 2 and 50 characters`);
        }
      }
    }
  }

  // --- Validate optional environment variables ---

  let port = 3000;
  const portEnv = process.env.PORT;
  if (portEnv !== undefined && portEnv.trim().length > 0) {
    const parsedPort = parseInt(portEnv.trim(), 10);
    if (isNaN(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      errors.push('PORT must be a valid number between 1 and 65535');
    } else {
      port = parsedPort;
    }
  }

  let retentionHours = 24;
  const retentionEnv = process.env.RETENTION_HOURS;
  if (retentionEnv !== undefined && retentionEnv.trim().length > 0) {
    const parsedRetention = parseInt(retentionEnv.trim(), 10);
    if (isNaN(parsedRetention) || parsedRetention < 1 || parsedRetention > 168) {
      errors.push('RETENTION_HOURS must be a valid number between 1 and 168');
    } else {
      retentionHours = parsedRetention;
    }
  }

  // --- Load system prompt ---
  const systemPrompt = loadSystemPrompt(errors);

  // --- If there are validation errors, throw them all at once ---
  if (errors.length > 0) {
    throw new ConfigError(errors);
  }

  // --- Build and return the config object ---
  const config = {
    openai: {
      apiKey: openaiApiKey.trim(),
      model: process.env.OPENAI_MODEL || 'gpt-4',
      timeout: 30000
    },
    zapi: {
      instanceId: zapiInstanceId.trim(),
      token: zapiToken.trim(),
      webhookSecret: zapiWebhookSecret ? zapiWebhookSecret.trim() : null,
      clientToken: process.env.ZAPI_CLIENT_TOKEN ? process.env.ZAPI_CLIENT_TOKEN.trim() : null
    },
    handoff: {
      triggerKeywords: handoffTrigger.split('|').map(t => t.trim()).filter(t => t.length > 0)
    },
    server: {
      port
    },
    storage: {
      filePath: process.env.STATE_FILE_PATH || path.join(__dirname, '..', '..', 'data', 'state.json'),
      retentionHours,
      maxMessagesPerConversation: 500
    },
    systemPrompt
  };

  return config;
}

/**
 * Returns a safe representation of the config for logging purposes.
 * Credential values are masked.
 *
 * @param {object} config - The configuration object
 * @returns {object} Config with credentials masked
 */
function getSafeConfigForLogging(config) {
  return {
    openai: {
      apiKey: '***REDACTED***',
      model: config.openai.model,
      timeout: config.openai.timeout
    },
    zapi: {
      instanceId: config.zapi.instanceId,
      token: '***REDACTED***',
      webhookSecret: '***REDACTED***'
    },
    handoff: { ...config.handoff },
    server: { ...config.server },
    storage: { ...config.storage },
    systemPrompt: config.systemPrompt.substring(0, 50) + (config.systemPrompt.length > 50 ? '...' : '')
  };
}

module.exports = {
  loadConfig,
  ConfigError,
  getSafeConfigForLogging,
  CREDENTIAL_VARS
};
