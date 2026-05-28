'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { StateRepository } = require('../../src/repository/stateRepository');

describe('StateRepository - File-based Persistence', () => {
  let repo;
  let tempDir;
  let filePath;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'state-repo-test-'));
    filePath = path.join(tempDir, 'state.json');
    repo = new StateRepository({
      maxMessagesPerConversation: 500,
      retentionHours: 24,
      filePath
    });
  });

  afterEach(() => {
    // Clear any pending timers
    if (repo._persistTimer) {
      clearTimeout(repo._persistTimer);
      repo._persistTimer = null;
    }
    // Clean up temp directory
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('constructor - filePath config', () => {
    it('uses provided filePath', () => {
      const customPath = path.join(tempDir, 'custom', 'state.json');
      const r = new StateRepository({ filePath: customPath });
      expect(r.filePath).toBe(customPath);
    });

    it('defaults to data/state.json relative to cwd when no filePath provided', () => {
      const r = new StateRepository();
      expect(r.filePath).toBe(path.join(process.cwd(), 'data', 'state.json'));
    });
  });

  describe('persistToDisk', () => {
    it('writes state to the configured file path', async () => {
      repo.appendMessage('+5511999999999', {
        role: 'user',
        content: 'Hello',
        timestamp: '2024-01-15T10:00:00.000Z'
      });

      await repo.persistToDisk();

      expect(fs.existsSync(filePath)).toBe(true);
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      expect(data.version).toBe(1);
      expect(data.lastSavedAt).toBeDefined();
      expect(data.conversations['+5511999999999']).toBeDefined();
      expect(data.conversations['+5511999999999'].messages).toHaveLength(1);
    });

    it('creates directory if it does not exist', async () => {
      const nestedPath = path.join(tempDir, 'nested', 'dir', 'state.json');
      const r = new StateRepository({ filePath: nestedPath });
      r.appendMessage('+5511999999999', { role: 'user', content: 'Test' });

      await r.persistToDisk();

      expect(fs.existsSync(nestedPath)).toBe(true);
    });

    it('uses atomic write (temp file then rename)', async () => {
      repo.appendMessage('+5511999999999', { role: 'user', content: 'Test' });
      await repo.persistToDisk();

      // Temp file should not exist after successful write
      expect(fs.existsSync(filePath + '.tmp')).toBe(false);
      // Main file should exist
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('serializes multiple conversations correctly', async () => {
      repo.appendMessage('+5511111111111', { role: 'user', content: 'Hello 1' });
      repo.appendMessage('+5522222222222', { role: 'user', content: 'Hello 2' });
      repo.setControlMode('+5522222222222', 'Human');

      await repo.persistToDisk();

      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      expect(Object.keys(data.conversations)).toHaveLength(2);
      expect(data.conversations['+5511111111111'].controlMode).toBe('AI');
      expect(data.conversations['+5522222222222'].controlMode).toBe('Human');
    });

    it('logs error but does not throw on write failure', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      // Use an invalid path that can't be written
      const r = new StateRepository({ filePath: path.join(tempDir, '\0invalid', 'state.json') });
      r.appendMessage('+5511999999999', { role: 'user', content: 'Test' });

      // Should not throw
      await expect(r.persistToDisk()).resolves.toBeUndefined();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[StateRepository] Failed to persist state to disk'));

      consoleSpy.mockRestore();
    });

    it('includes lastSavedAt as ISO 8601 timestamp', async () => {
      const before = new Date().toISOString();
      await repo.persistToDisk();
      const after = new Date().toISOString();

      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      expect(data.lastSavedAt >= before).toBe(true);
      expect(data.lastSavedAt <= after).toBe(true);
    });
  });

  describe('loadFromDisk', () => {
    it('loads persisted state correctly', async () => {
      // Persist some state
      repo.appendMessage('+5511999999999', {
        role: 'user',
        content: 'Hello',
        timestamp: '2024-01-15T10:00:00.000Z'
      });
      repo.setControlMode('+5511999999999', 'Human');
      await repo.persistToDisk();

      // Create a new repo and load from disk
      const newRepo = new StateRepository({ filePath });
      await newRepo.loadFromDisk();

      expect(newRepo.conversations.size).toBe(1);
      expect(newRepo.getControlMode('+5511999999999')).toBe('Human');
      const history = newRepo.getHistory('+5511999999999');
      expect(history).toHaveLength(1);
      expect(history[0].content).toBe('Hello');
    });

    it('starts with empty state if file does not exist', async () => {
      const newRepo = new StateRepository({ filePath: path.join(tempDir, 'nonexistent.json') });
      await newRepo.loadFromDisk();

      expect(newRepo.conversations.size).toBe(0);
    });

    it('logs error and initializes empty state if file is corrupted JSON', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      fs.writeFileSync(filePath, 'not valid json {{{', 'utf8');

      const newRepo = new StateRepository({ filePath });
      await newRepo.loadFromDisk();

      expect(newRepo.conversations.size).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[StateRepository] Failed to load state from disk'));

      consoleSpy.mockRestore();
    });

    it('logs error and initializes empty state if file has invalid structure', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      fs.writeFileSync(filePath, JSON.stringify({ version: 1 }), 'utf8');

      const newRepo = new StateRepository({ filePath });
      await newRepo.loadFromDisk();

      expect(newRepo.conversations.size).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid state file structure'));

      consoleSpy.mockRestore();
    });

    it('skips conversations with missing required fields', async () => {
      const state = {
        conversations: {
          '+5511111111111': {
            phoneNumber: '+5511111111111',
            controlMode: 'AI',
            messages: [{ id: '1', role: 'user', content: 'Hi', timestamp: '2024-01-15T10:00:00.000Z' }],
            lastMessageAt: '2024-01-15T10:00:00.000Z',
            createdAt: '2024-01-15T09:00:00.000Z'
          },
          '+5522222222222': {
            // Missing phoneNumber field
            controlMode: 'AI',
            messages: []
          }
        },
        lastSavedAt: '2024-01-15T10:00:00.000Z',
        version: 1
      };
      fs.writeFileSync(filePath, JSON.stringify(state), 'utf8');

      const newRepo = new StateRepository({ filePath });
      await newRepo.loadFromDisk();

      expect(newRepo.conversations.size).toBe(1);
      expect(newRepo.conversations.has('+5511111111111')).toBe(true);
      expect(newRepo.conversations.has('+5522222222222')).toBe(false);
    });

    it('clears existing in-memory state before loading', async () => {
      repo.appendMessage('+5500000000000', { role: 'user', content: 'Old data' });

      // Write a different state to disk
      const state = {
        conversations: {
          '+5511111111111': {
            phoneNumber: '+5511111111111',
            controlMode: 'Human',
            messages: [{ id: '1', role: 'user', content: 'New data', timestamp: '2024-01-15T10:00:00.000Z' }],
            lastMessageAt: '2024-01-15T10:00:00.000Z',
            createdAt: '2024-01-15T09:00:00.000Z'
          }
        },
        lastSavedAt: '2024-01-15T10:00:00.000Z',
        version: 1
      };
      fs.writeFileSync(filePath, JSON.stringify(state), 'utf8');

      await repo.loadFromDisk();

      expect(repo.conversations.size).toBe(1);
      expect(repo.conversations.has('+5500000000000')).toBe(false);
      expect(repo.conversations.has('+5511111111111')).toBe(true);
    });
  });

  describe('getActiveConversations', () => {
    it('returns conversations with messages within retention period', () => {
      const now = new Date();
      repo.appendMessage('+5511111111111', {
        role: 'user',
        content: 'Recent message',
        timestamp: now.toISOString()
      });

      const active = repo.getActiveConversations();
      expect(active).toHaveLength(1);
      expect(active[0].phoneNumber).toBe('+5511111111111');
    });

    it('excludes conversations with only expired messages', () => {
      const expired = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(); // 25 hours ago
      repo.getOrCreateConversation('+5511111111111');
      repo.conversations.get('+5511111111111').messages.push({
        id: 'msg1',
        role: 'user',
        content: 'Old message',
        timestamp: expired
      });
      repo.conversations.get('+5511111111111').lastMessageAt = expired;

      const active = repo.getActiveConversations();
      expect(active).toHaveLength(0);
    });

    it('returns correct ConversationSummary shape', () => {
      const now = new Date().toISOString();
      repo.appendMessage('+5511999999999', {
        role: 'user',
        content: 'Hello',
        timestamp: now
      });
      repo.setControlMode('+5511999999999', 'Human');

      const active = repo.getActiveConversations();
      expect(active).toHaveLength(1);
      expect(active[0]).toEqual({
        phoneNumber: '+5511999999999',
        controlMode: 'Human',
        lastMessageAt: now,
        messageCount: 1
      });
    });

    it('sorts by lastMessageAt descending (most recent first)', () => {
      repo.appendMessage('+5511111111111', {
        role: 'user',
        content: 'First',
        timestamp: '2024-01-15T10:00:00.000Z'
      });
      repo.appendMessage('+5522222222222', {
        role: 'user',
        content: 'Second',
        timestamp: new Date().toISOString()
      });
      repo.appendMessage('+5533333333333', {
        role: 'user',
        content: 'Third',
        timestamp: new Date(Date.now() - 1000).toISOString()
      });

      const active = repo.getActiveConversations();
      // Most recent first
      expect(active[0].phoneNumber).toBe('+5522222222222');
      expect(active[1].phoneNumber).toBe('+5533333333333');
    });

    it('returns empty array when no conversations exist', () => {
      const active = repo.getActiveConversations();
      expect(active).toEqual([]);
    });

    it('returns empty array when all conversations have no messages', () => {
      repo.getOrCreateConversation('+5511111111111');
      repo.getOrCreateConversation('+5522222222222');

      const active = repo.getActiveConversations();
      expect(active).toEqual([]);
    });

    it('includes conversation if at least one message is within retention', () => {
      const expired = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      const recent = new Date().toISOString();

      repo.getOrCreateConversation('+5511111111111');
      const conv = repo.conversations.get('+5511111111111');
      conv.messages.push(
        { id: 'msg1', role: 'user', content: 'Old', timestamp: expired },
        { id: 'msg2', role: 'user', content: 'New', timestamp: recent }
      );
      conv.lastMessageAt = recent;

      const active = repo.getActiveConversations();
      expect(active).toHaveLength(1);
      expect(active[0].messageCount).toBe(2);
    });
  });

  describe('schedulePersist', () => {
    it('schedules persistence within 1 second', (done) => {
      const persistSpy = jest.spyOn(repo, 'persistToDisk').mockResolvedValue();

      repo.schedulePersist();

      // Should not be called immediately
      expect(persistSpy).not.toHaveBeenCalled();

      // Should be called after ~1 second
      setTimeout(() => {
        expect(persistSpy).toHaveBeenCalledTimes(1);
        persistSpy.mockRestore();
        done();
      }, 1100);
    });

    it('debounces multiple rapid calls into a single persist', (done) => {
      const persistSpy = jest.spyOn(repo, 'persistToDisk').mockResolvedValue();

      repo.schedulePersist();
      repo.schedulePersist();
      repo.schedulePersist();

      setTimeout(() => {
        expect(persistSpy).toHaveBeenCalledTimes(1);
        persistSpy.mockRestore();
        done();
      }, 1200);
    });

    it('is triggered by setControlMode', () => {
      const scheduleSpy = jest.spyOn(repo, 'schedulePersist');
      repo.setControlMode('+5511999999999', 'Human');
      expect(scheduleSpy).toHaveBeenCalledTimes(1);
      scheduleSpy.mockRestore();
    });

    it('is triggered by appendMessage', () => {
      const scheduleSpy = jest.spyOn(repo, 'schedulePersist');
      repo.appendMessage('+5511999999999', { role: 'user', content: 'Test' });
      expect(scheduleSpy).toHaveBeenCalledTimes(1);
      scheduleSpy.mockRestore();
    });
  });

  describe('round-trip persistence', () => {
    it('persists and loads state correctly across instances', async () => {
      // Set up state
      repo.appendMessage('+5511111111111', {
        role: 'user',
        content: 'Hello from user',
        timestamp: '2024-01-15T10:00:00.000Z'
      });
      repo.appendMessage('+5511111111111', {
        role: 'assistant',
        content: 'Hello from bot',
        timestamp: '2024-01-15T10:00:01.000Z'
      });
      repo.setControlMode('+5511111111111', 'Human');

      repo.appendMessage('+5522222222222', {
        role: 'user',
        content: 'Another conversation',
        timestamp: '2024-01-15T10:01:00.000Z'
      });

      // Persist
      await repo.persistToDisk();

      // Load in new instance
      const newRepo = new StateRepository({ filePath });
      await newRepo.loadFromDisk();

      // Verify
      expect(newRepo.conversations.size).toBe(2);
      expect(newRepo.getControlMode('+5511111111111')).toBe('Human');
      expect(newRepo.getControlMode('+5522222222222')).toBe('AI');

      const history1 = newRepo.getHistory('+5511111111111');
      expect(history1).toHaveLength(2);
      expect(history1[0].content).toBe('Hello from user');
      expect(history1[1].content).toBe('Hello from bot');

      const history2 = newRepo.getHistory('+5522222222222');
      expect(history2).toHaveLength(1);
      expect(history2[0].content).toBe('Another conversation');
    });
  });
});
