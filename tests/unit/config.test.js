'use strict';

const path = require('path');
const fs = require('fs');

// Store original env
const originalEnv = process.env;

// Mock dotenv to prevent it from loading a real .env file during tests
jest.mock('dotenv', () => ({
  config: jest.fn()
}));

// Mock fs for system prompt file fallback tests
jest.mock('fs');

describe('Configuration Module', () => {
  let loadConfig, ConfigError, getSafeConfigForLogging;

  beforeEach(() => {
    // Reset modules to get fresh config each time
    jest.resetModules();
    process.env = { ...originalEnv };

    // Set up valid required env vars by default
    process.env.OPENAI_API_KEY = 'sk-test-key-12345';
    process.env.ZAPI_INSTANCE_ID = 'instance-123';
    process.env.ZAPI_TOKEN = 'token-abc-456';
    process.env.ZAPI_WEBHOOK_SECRET = 'webhook-secret-xyz';
    process.env.HANDOFF_TRIGGER = 'humano';

    // Mock fs to not find system prompt file by default
    fs.existsSync.mockReturnValue(false);
    fs.readFileSync.mockReturnValue('');

    // Re-require after resetting modules
    const config = require('../../src/config/index');
    loadConfig = config.loadConfig;
    ConfigError = config.ConfigError;
    getSafeConfigForLogging = config.getSafeConfigForLogging;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('loadConfig() - successful loading', () => {
    test('returns valid config object with all required env vars set', () => {
      const config = loadConfig();

      expect(config).toHaveProperty('openai');
      expect(config).toHaveProperty('zapi');
      expect(config).toHaveProperty('handoff');
      expect(config).toHaveProperty('server');
      expect(config).toHaveProperty('storage');
      expect(config).toHaveProperty('systemPrompt');
    });

    test('correctly maps required environment variables', () => {
      const config = loadConfig();

      expect(config.openai.apiKey).toBe('sk-test-key-12345');
      expect(config.zapi.instanceId).toBe('instance-123');
      expect(config.zapi.token).toBe('token-abc-456');
      expect(config.zapi.webhookSecret).toBe('webhook-secret-xyz');
      expect(config.handoff.triggerKeywords).toEqual(['humano']);
    });

    test('uses default port 3000 when PORT is not set', () => {
      delete process.env.PORT;
      const config = loadConfig();
      expect(config.server.port).toBe(3000);
    });

    test('uses custom port when PORT is set', () => {
      process.env.PORT = '8080';
      const config = loadConfig();
      expect(config.server.port).toBe(8080);
    });

    test('uses default retention hours of 24 when not set', () => {
      delete process.env.RETENTION_HOURS;
      const config = loadConfig();
      expect(config.storage.retentionHours).toBe(24);
    });

    test('uses custom retention hours when set', () => {
      process.env.RETENTION_HOURS = '48';
      const config = loadConfig();
      expect(config.storage.retentionHours).toBe(48);
    });

    test('trims whitespace from environment variable values', () => {
      process.env.OPENAI_API_KEY = '  sk-test-key  ';
      process.env.ZAPI_INSTANCE_ID = '  instance-123  ';
      process.env.HANDOFF_TRIGGER = '  humano  ';

      const config = loadConfig();

      expect(config.openai.apiKey).toBe('sk-test-key');
      expect(config.zapi.instanceId).toBe('instance-123');
      expect(config.handoff.triggerKeywords).toEqual(['humano']);
    });

    test('sets default OpenAI model to gpt-4', () => {
      const config = loadConfig();
      expect(config.openai.model).toBe('gpt-4');
    });

    test('sets OpenAI timeout to 30000ms', () => {
      const config = loadConfig();
      expect(config.openai.timeout).toBe(30000);
    });

    test('sets max messages per conversation to 500', () => {
      const config = loadConfig();
      expect(config.storage.maxMessagesPerConversation).toBe(500);
    });
  });

  describe('loadConfig() - validation errors', () => {
    test('throws ConfigError when OPENAI_API_KEY is missing', () => {
      delete process.env.OPENAI_API_KEY;
      expect(() => loadConfig()).toThrow(ConfigError);
    });

    test('throws ConfigError when ZAPI_INSTANCE_ID is missing', () => {
      delete process.env.ZAPI_INSTANCE_ID;
      expect(() => loadConfig()).toThrow(ConfigError);
    });

    test('throws ConfigError when ZAPI_TOKEN is missing', () => {
      delete process.env.ZAPI_TOKEN;
      expect(() => loadConfig()).toThrow(ConfigError);
    });

    test('does not throw when ZAPI_WEBHOOK_SECRET is missing (optional)', () => {
      delete process.env.ZAPI_WEBHOOK_SECRET;
      expect(() => loadConfig()).not.toThrow();
      const config = loadConfig();
      expect(config.zapi.webhookSecret).toBeNull();
    });

    test('throws ConfigError when HANDOFF_TRIGGER is missing', () => {
      delete process.env.HANDOFF_TRIGGER;
      expect(() => loadConfig()).toThrow(ConfigError);
    });

    test('throws ConfigError when required var is whitespace-only', () => {
      process.env.OPENAI_API_KEY = '   ';
      expect(() => loadConfig()).toThrow(ConfigError);
    });

    test('throws ConfigError when required var is empty string', () => {
      process.env.ZAPI_TOKEN = '';
      expect(() => loadConfig()).toThrow(ConfigError);
    });

    test('reports ALL missing variables in a single error', () => {
      delete process.env.OPENAI_API_KEY;
      delete process.env.ZAPI_INSTANCE_ID;
      delete process.env.ZAPI_TOKEN;
      delete process.env.ZAPI_WEBHOOK_SECRET;
      delete process.env.HANDOFF_TRIGGER;

      try {
        loadConfig();
        fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError);
        expect(err.errors).toHaveLength(4);
        expect(err.errors[0]).toContain('OPENAI_API_KEY');
        expect(err.errors[1]).toContain('ZAPI_INSTANCE_ID');
        expect(err.errors[2]).toContain('ZAPI_TOKEN');
        expect(err.errors[3]).toContain('HANDOFF_TRIGGER');
      }
    });

    test('throws ConfigError when HANDOFF_TRIGGER is too short (1 char)', () => {
      process.env.HANDOFF_TRIGGER = 'x';
      try {
        loadConfig();
        fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError);
        expect(err.errors.some(e => e.includes('HANDOFF_TRIGGER') && e.includes('2 and 50'))).toBe(true);
      }
    });

    test('throws ConfigError when HANDOFF_TRIGGER exceeds 50 chars', () => {
      process.env.HANDOFF_TRIGGER = 'a'.repeat(51);
      try {
        loadConfig();
        fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError);
        expect(err.errors.some(e => e.includes('HANDOFF_TRIGGER') && e.includes('2 and 50'))).toBe(true);
      }
    });

    test('throws ConfigError when PORT is invalid', () => {
      process.env.PORT = 'not-a-number';
      try {
        loadConfig();
        fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError);
        expect(err.errors.some(e => e.includes('PORT'))).toBe(true);
      }
    });

    test('throws ConfigError when PORT is out of range', () => {
      process.env.PORT = '99999';
      try {
        loadConfig();
        fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError);
        expect(err.errors.some(e => e.includes('PORT'))).toBe(true);
      }
    });

    test('throws ConfigError when RETENTION_HOURS is below minimum (1)', () => {
      process.env.RETENTION_HOURS = '0';
      try {
        loadConfig();
        fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError);
        expect(err.errors.some(e => e.includes('RETENTION_HOURS'))).toBe(true);
      }
    });

    test('throws ConfigError when RETENTION_HOURS exceeds maximum (168)', () => {
      process.env.RETENTION_HOURS = '200';
      try {
        loadConfig();
        fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError);
        expect(err.errors.some(e => e.includes('RETENTION_HOURS'))).toBe(true);
      }
    });
  });

  describe('loadConfig() - System Prompt', () => {
    test('loads system prompt from SYSTEM_PROMPT env var', () => {
      process.env.SYSTEM_PROMPT = 'You are a custom assistant.';
      const config = loadConfig();
      expect(config.systemPrompt).toBe('You are a custom assistant.');
    });

    test('falls back to config file when SYSTEM_PROMPT env var is not set', () => {
      delete process.env.SYSTEM_PROMPT;

      // Need to re-require with updated fs mocks
      jest.resetModules();
      const fsMock = require('fs');
      fsMock.existsSync.mockReturnValue(true);
      fsMock.readFileSync.mockReturnValue('Prompt from file.');

      const { loadConfig: loadConfigFresh } = require('../../src/config/index');
      const config = loadConfigFresh();
      expect(config.systemPrompt).toBe('Prompt from file.');
    });

    test('uses default prompt when neither env var nor file is available', () => {
      delete process.env.SYSTEM_PROMPT;
      fs.existsSync.mockReturnValue(false);

      const config = loadConfig();
      expect(config.systemPrompt).toBe('You are a helpful WhatsApp assistant.');
    });

    test('truncates system prompt exceeding 4000 characters and reports error', () => {
      process.env.SYSTEM_PROMPT = 'x'.repeat(4001);
      try {
        loadConfig();
        fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError);
        expect(err.errors.some(e => e.includes('SYSTEM_PROMPT') && e.includes('4000'))).toBe(true);
      }
    });

    test('accepts system prompt at exactly 4000 characters', () => {
      process.env.SYSTEM_PROMPT = 'x'.repeat(4000);
      const config = loadConfig();
      expect(config.systemPrompt.length).toBe(4000);
    });

    test('falls back to default when SYSTEM_PROMPT is whitespace-only', () => {
      process.env.SYSTEM_PROMPT = '   ';
      fs.existsSync.mockReturnValue(false);

      const config = loadConfig();
      expect(config.systemPrompt).toBe('You are a helpful WhatsApp assistant.');
    });
  });

  describe('getSafeConfigForLogging()', () => {
    test('masks OPENAI_API_KEY in output', () => {
      const config = loadConfig();
      const safe = getSafeConfigForLogging(config);
      expect(safe.openai.apiKey).toBe('***REDACTED***');
    });

    test('masks ZAPI_TOKEN in output', () => {
      const config = loadConfig();
      const safe = getSafeConfigForLogging(config);
      expect(safe.zapi.token).toBe('***REDACTED***');
    });

    test('masks ZAPI_WEBHOOK_SECRET in output', () => {
      const config = loadConfig();
      const safe = getSafeConfigForLogging(config);
      expect(safe.zapi.webhookSecret).toBe('***REDACTED***');
    });

    test('does not mask non-credential values', () => {
      const config = loadConfig();
      const safe = getSafeConfigForLogging(config);
      expect(safe.zapi.instanceId).toBe('instance-123');
      expect(safe.server.port).toBe(3000);
      expect(safe.handoff.triggerKeywords).toEqual(['humano']);
    });

    test('credential values from config do not appear in safe output', () => {
      const config = loadConfig();
      const safe = getSafeConfigForLogging(config);
      const safeStr = JSON.stringify(safe);

      expect(safeStr).not.toContain('sk-test-key-12345');
      expect(safeStr).not.toContain('token-abc-456');
      expect(safeStr).not.toContain('webhook-secret-xyz');
    });
  });

  describe('ConfigError', () => {
    test('has correct name property', () => {
      const err = new ConfigError(['test error']);
      expect(err.name).toBe('ConfigError');
    });

    test('contains all errors in the errors array', () => {
      const errors = ['error 1', 'error 2', 'error 3'];
      const err = new ConfigError(errors);
      expect(err.errors).toEqual(errors);
    });

    test('message includes all error descriptions', () => {
      const errors = ['OPENAI_API_KEY missing', 'ZAPI_TOKEN missing'];
      const err = new ConfigError(errors);
      expect(err.message).toContain('OPENAI_API_KEY missing');
      expect(err.message).toContain('ZAPI_TOKEN missing');
    });
  });
});
