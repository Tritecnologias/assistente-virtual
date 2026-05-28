'use strict';

const { StateRepository } = require('../../src/repository/stateRepository');

describe('StateRepository - Core State Management', () => {
  let repo;

  beforeEach(() => {
    repo = new StateRepository({ maxMessagesPerConversation: 500, retentionHours: 24 });
  });

  describe('getOrCreateConversation', () => {
    it('creates a new conversation with default "AI" mode', () => {
      const conv = repo.getOrCreateConversation('+5511999999999');

      expect(conv.phoneNumber).toBe('+5511999999999');
      expect(conv.controlMode).toBe('AI');
      expect(conv.messages).toEqual([]);
      expect(conv.createdAt).toBeDefined();
      expect(conv.lastMessageAt).toBeDefined();
    });

    it('returns existing conversation if already created', () => {
      const first = repo.getOrCreateConversation('+5511999999999');
      first.controlMode = 'Human';

      const second = repo.getOrCreateConversation('+5511999999999');
      expect(second.controlMode).toBe('Human');
      expect(second).toBe(first);
    });

    it('creates separate conversations for different phone numbers', () => {
      const conv1 = repo.getOrCreateConversation('+5511111111111');
      const conv2 = repo.getOrCreateConversation('+5522222222222');

      expect(conv1).not.toBe(conv2);
      expect(conv1.phoneNumber).toBe('+5511111111111');
      expect(conv2.phoneNumber).toBe('+5522222222222');
    });

    it('sets createdAt and lastMessageAt to valid ISO 8601 timestamps', () => {
      const conv = repo.getOrCreateConversation('+5511999999999');

      expect(() => new Date(conv.createdAt)).not.toThrow();
      expect(new Date(conv.createdAt).toISOString()).toBe(conv.createdAt);
      expect(new Date(conv.lastMessageAt).toISOString()).toBe(conv.lastMessageAt);
    });
  });

  describe('getControlMode', () => {
    it('returns "AI" for a new conversation', () => {
      expect(repo.getControlMode('+5511999999999')).toBe('AI');
    });

    it('returns the current mode after it has been changed', () => {
      repo.setControlMode('+5511999999999', 'Human');
      expect(repo.getControlMode('+5511999999999')).toBe('Human');
    });

    it('creates the conversation if it does not exist', () => {
      const mode = repo.getControlMode('+5500000000000');
      expect(mode).toBe('AI');
      expect(repo.conversations.has('+5500000000000')).toBe(true);
    });
  });

  describe('setControlMode', () => {
    it('sets mode to "Human"', () => {
      repo.setControlMode('+5511999999999', 'Human');
      expect(repo.getControlMode('+5511999999999')).toBe('Human');
    });

    it('sets mode back to "AI"', () => {
      repo.setControlMode('+5511999999999', 'Human');
      repo.setControlMode('+5511999999999', 'AI');
      expect(repo.getControlMode('+5511999999999')).toBe('AI');
    });

    it('throws on invalid mode', () => {
      expect(() => repo.setControlMode('+5511999999999', 'invalid')).toThrow(/Invalid control mode/);
    });

    it('creates the conversation if it does not exist', () => {
      repo.setControlMode('+5500000000000', 'Human');
      expect(repo.conversations.has('+5500000000000')).toBe(true);
      expect(repo.getControlMode('+5500000000000')).toBe('Human');
    });
  });

  describe('appendMessage', () => {
    it('appends a user message with correct fields', () => {
      repo.appendMessage('+5511999999999', {
        role: 'user',
        content: 'Hello',
        timestamp: '2024-01-15T10:00:00.000Z'
      });

      const history = repo.getHistory('+5511999999999');
      expect(history).toHaveLength(1);
      expect(history[0].role).toBe('user');
      expect(history[0].content).toBe('Hello');
      expect(history[0].timestamp).toBe('2024-01-15T10:00:00.000Z');
      expect(history[0].id).toBeDefined();
    });

    it('appends an assistant message', () => {
      repo.appendMessage('+5511999999999', {
        role: 'assistant',
        content: 'Hi there!',
        timestamp: '2024-01-15T10:01:00.000Z'
      });

      const history = repo.getHistory('+5511999999999');
      expect(history).toHaveLength(1);
      expect(history[0].role).toBe('assistant');
      expect(history[0].content).toBe('Hi there!');
    });

    it('truncates content to 4096 characters', () => {
      const longContent = 'a'.repeat(5000);
      repo.appendMessage('+5511999999999', {
        role: 'user',
        content: longContent
      });

      const history = repo.getHistory('+5511999999999');
      expect(history[0].content.length).toBe(4096);
    });

    it('stores content exactly at 4096 characters without truncation', () => {
      const exactContent = 'b'.repeat(4096);
      repo.appendMessage('+5511999999999', {
        role: 'user',
        content: exactContent
      });

      const history = repo.getHistory('+5511999999999');
      expect(history[0].content.length).toBe(4096);
      expect(history[0].content).toBe(exactContent);
    });

    it('uses provided message id', () => {
      repo.appendMessage('+5511999999999', {
        id: 'custom-id-123',
        role: 'user',
        content: 'Test'
      });

      const history = repo.getHistory('+5511999999999');
      expect(history[0].id).toBe('custom-id-123');
    });

    it('auto-generates id if not provided', () => {
      repo.appendMessage('+5511999999999', {
        role: 'user',
        content: 'Test'
      });

      const history = repo.getHistory('+5511999999999');
      expect(history[0].id).toMatch(/^msg_/);
    });

    it('auto-generates timestamp if not provided', () => {
      const before = new Date().toISOString();
      repo.appendMessage('+5511999999999', {
        role: 'user',
        content: 'Test'
      });
      const after = new Date().toISOString();

      const history = repo.getHistory('+5511999999999');
      expect(history[0].timestamp >= before).toBe(true);
      expect(history[0].timestamp <= after).toBe(true);
    });

    it('updates lastMessageAt on the conversation', () => {
      repo.appendMessage('+5511999999999', {
        role: 'user',
        content: 'First',
        timestamp: '2024-01-15T10:00:00.000Z'
      });

      const conv = repo.getOrCreateConversation('+5511999999999');
      expect(conv.lastMessageAt).toBe('2024-01-15T10:00:00.000Z');

      repo.appendMessage('+5511999999999', {
        role: 'assistant',
        content: 'Second',
        timestamp: '2024-01-15T10:01:00.000Z'
      });

      expect(conv.lastMessageAt).toBe('2024-01-15T10:01:00.000Z');
    });

    it('throws on invalid role', () => {
      expect(() => repo.appendMessage('+5511999999999', {
        role: 'system',
        content: 'Test'
      })).toThrow(/Invalid message role/);
    });

    it('handles empty content gracefully', () => {
      repo.appendMessage('+5511999999999', {
        role: 'user',
        content: ''
      });

      const history = repo.getHistory('+5511999999999');
      expect(history[0].content).toBe('');
    });

    it('enforces max 500 messages per conversation', () => {
      const smallRepo = new StateRepository({ maxMessagesPerConversation: 5 });

      for (let i = 0; i < 7; i++) {
        smallRepo.appendMessage('+5511999999999', {
          role: 'user',
          content: `Message ${i}`,
          timestamp: `2024-01-15T10:0${i}:00.000Z`
        });
      }

      const history = smallRepo.getHistory('+5511999999999', 100);
      expect(history).toHaveLength(5);
      // Should have the most recent 5 messages (indices 2-6)
      expect(history[0].content).toBe('Message 2');
      expect(history[4].content).toBe('Message 6');
    });

    it('removes oldest messages when cap is exceeded', () => {
      const smallRepo = new StateRepository({ maxMessagesPerConversation: 3 });

      smallRepo.appendMessage('+5511999999999', { role: 'user', content: 'A', timestamp: '2024-01-01T01:00:00.000Z' });
      smallRepo.appendMessage('+5511999999999', { role: 'assistant', content: 'B', timestamp: '2024-01-01T02:00:00.000Z' });
      smallRepo.appendMessage('+5511999999999', { role: 'user', content: 'C', timestamp: '2024-01-01T03:00:00.000Z' });
      smallRepo.appendMessage('+5511999999999', { role: 'assistant', content: 'D', timestamp: '2024-01-01T04:00:00.000Z' });

      const history = smallRepo.getHistory('+5511999999999', 100);
      expect(history).toHaveLength(3);
      expect(history[0].content).toBe('B');
      expect(history[1].content).toBe('C');
      expect(history[2].content).toBe('D');
    });
  });

  describe('getHistory', () => {
    beforeEach(() => {
      for (let i = 0; i < 10; i++) {
        repo.appendMessage('+5511999999999', {
          role: i % 2 === 0 ? 'user' : 'assistant',
          content: `Message ${i}`,
          timestamp: `2024-01-15T10:${String(i).padStart(2, '0')}:00.000Z`
        });
      }
    });

    it('returns messages in chronological order (oldest first)', () => {
      const history = repo.getHistory('+5511999999999');

      for (let i = 1; i < history.length; i++) {
        expect(history[i].timestamp >= history[i - 1].timestamp).toBe(true);
      }
    });

    it('defaults to limit of 20', () => {
      // Add more messages to exceed 20
      for (let i = 10; i < 30; i++) {
        repo.appendMessage('+5511999999999', {
          role: 'user',
          content: `Message ${i}`,
          timestamp: `2024-01-15T11:${String(i).padStart(2, '0')}:00.000Z`
        });
      }

      const history = repo.getHistory('+5511999999999');
      expect(history).toHaveLength(20);
    });

    it('returns all messages when fewer than limit', () => {
      const history = repo.getHistory('+5511999999999', 50);
      expect(history).toHaveLength(10);
    });

    it('respects custom limit', () => {
      const history = repo.getHistory('+5511999999999', 5);
      expect(history).toHaveLength(5);
      // Should return the most recent 5 messages
      expect(history[0].content).toBe('Message 5');
      expect(history[4].content).toBe('Message 9');
    });

    it('returns empty array for new conversation', () => {
      const history = repo.getHistory('+5500000000000');
      expect(history).toEqual([]);
    });

    it('returns a copy, not a reference to internal array', () => {
      const history = repo.getHistory('+5511999999999', 5);
      history.push({ role: 'user', content: 'injected' });

      const historyAgain = repo.getHistory('+5511999999999', 5);
      expect(historyAgain).toHaveLength(5);
    });
  });

  describe('max messages enforcement (500 limit)', () => {
    it('enforces the default 500 message cap', () => {
      for (let i = 0; i < 510; i++) {
        repo.appendMessage('+5511999999999', {
          role: 'user',
          content: `Msg ${i}`
        });
      }

      const conv = repo.getOrCreateConversation('+5511999999999');
      expect(conv.messages.length).toBe(500);
    });

    it('preserves chronological order after cap enforcement', () => {
      for (let i = 0; i < 510; i++) {
        repo.appendMessage('+5511999999999', {
          role: 'user',
          content: `Msg ${i}`,
          timestamp: new Date(Date.now() + i * 1000).toISOString()
        });
      }

      const history = repo.getHistory('+5511999999999', 500);
      for (let i = 1; i < history.length; i++) {
        expect(history[i].timestamp >= history[i - 1].timestamp).toBe(true);
      }
      // First message should be Msg 10 (oldest 10 removed)
      expect(history[0].content).toBe('Msg 10');
      expect(history[499].content).toBe('Msg 509');
    });
  });
});
