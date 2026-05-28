'use strict';

const { StateRepository } = require('../../src/repository/stateRepository');

describe('StateRepository - Deduplication and Cleanup', () => {
  let repo;

  beforeEach(() => {
    repo = new StateRepository({ maxMessagesPerConversation: 500, retentionHours: 24 });
  });

  afterEach(() => {
    repo.stopCleanupInterval();
  });

  describe('isDuplicate', () => {
    it('returns false for a message ID that has not been recorded', () => {
      expect(repo.isDuplicate('msg-123')).toBe(false);
    });

    it('returns true for a message ID recorded within the last 5 minutes', () => {
      repo.recordMessageId('msg-123');
      expect(repo.isDuplicate('msg-123')).toBe(true);
    });

    it('returns false for a message ID recorded more than 5 minutes ago', () => {
      // Manually set a timestamp older than 5 minutes
      const sixMinutesAgo = Date.now() - (6 * 60 * 1000);
      repo.messageIds.set('msg-old', sixMinutesAgo);

      expect(repo.isDuplicate('msg-old')).toBe(false);
    });

    it('removes expired entries when checked', () => {
      const sixMinutesAgo = Date.now() - (6 * 60 * 1000);
      repo.messageIds.set('msg-expired', sixMinutesAgo);

      repo.isDuplicate('msg-expired');
      expect(repo.messageIds.has('msg-expired')).toBe(false);
    });

    it('returns true for a message at exactly 4 minutes 59 seconds', () => {
      const justUnderFiveMin = Date.now() - (4 * 60 * 1000 + 59 * 1000);
      repo.messageIds.set('msg-border', justUnderFiveMin);

      expect(repo.isDuplicate('msg-border')).toBe(true);
    });

    it('handles multiple different message IDs independently', () => {
      repo.recordMessageId('msg-1');
      repo.recordMessageId('msg-2');

      expect(repo.isDuplicate('msg-1')).toBe(true);
      expect(repo.isDuplicate('msg-2')).toBe(true);
      expect(repo.isDuplicate('msg-3')).toBe(false);
    });
  });

  describe('recordMessageId', () => {
    it('stores the message ID in the messageIds map', () => {
      repo.recordMessageId('msg-abc');
      expect(repo.messageIds.has('msg-abc')).toBe(true);
    });

    it('stores the current timestamp', () => {
      const before = Date.now();
      repo.recordMessageId('msg-time');
      const after = Date.now();

      const recorded = repo.messageIds.get('msg-time');
      expect(recorded).toBeGreaterThanOrEqual(before);
      expect(recorded).toBeLessThanOrEqual(after);
    });

    it('overwrites timestamp if same message ID is recorded again', () => {
      const oldTime = Date.now() - (4 * 60 * 1000);
      repo.messageIds.set('msg-dup', oldTime);

      repo.recordMessageId('msg-dup');
      const newTime = repo.messageIds.get('msg-dup');
      expect(newTime).toBeGreaterThan(oldTime);
    });
  });

  describe('cleanup', () => {
    it('removes deduplication entries older than 5 minutes', () => {
      const sixMinutesAgo = Date.now() - (6 * 60 * 1000);
      const twoMinutesAgo = Date.now() - (2 * 60 * 1000);

      repo.messageIds.set('msg-old', sixMinutesAgo);
      repo.messageIds.set('msg-recent', twoMinutesAgo);

      repo.cleanup();

      expect(repo.messageIds.has('msg-old')).toBe(false);
      expect(repo.messageIds.has('msg-recent')).toBe(true);
    });

    it('removes messages older than retention period from conversations', () => {
      const now = new Date();
      const twentyFiveHoursAgo = new Date(now.getTime() - (25 * 60 * 60 * 1000)).toISOString();
      const oneHourAgo = new Date(now.getTime() - (1 * 60 * 60 * 1000)).toISOString();

      repo.appendMessage('+5511999999999', {
        role: 'user',
        content: 'Old message',
        timestamp: twentyFiveHoursAgo
      });
      repo.appendMessage('+5511999999999', {
        role: 'assistant',
        content: 'Recent message',
        timestamp: oneHourAgo
      });

      repo.cleanup();

      const history = repo.getHistory('+5511999999999', 100);
      expect(history).toHaveLength(1);
      expect(history[0].content).toBe('Recent message');
    });

    it('does not remove messages within the retention period', () => {
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - (2 * 60 * 60 * 1000)).toISOString();

      repo.appendMessage('+5511999999999', {
        role: 'user',
        content: 'Within retention',
        timestamp: twoHoursAgo
      });

      repo.cleanup();

      const history = repo.getHistory('+5511999999999', 100);
      expect(history).toHaveLength(1);
      expect(history[0].content).toBe('Within retention');
    });

    it('cleans up multiple conversations', () => {
      const now = new Date();
      const oldTimestamp = new Date(now.getTime() - (25 * 60 * 60 * 1000)).toISOString();
      const recentTimestamp = new Date(now.getTime() - (1 * 60 * 60 * 1000)).toISOString();

      repo.appendMessage('+5511111111111', {
        role: 'user',
        content: 'Old msg conv1',
        timestamp: oldTimestamp
      });
      repo.appendMessage('+5522222222222', {
        role: 'user',
        content: 'Recent msg conv2',
        timestamp: recentTimestamp
      });

      repo.cleanup();

      const history1 = repo.getHistory('+5511111111111', 100);
      const history2 = repo.getHistory('+5522222222222', 100);
      expect(history1).toHaveLength(0);
      expect(history2).toHaveLength(1);
    });

    it('updates lastMessageAt after removing messages', () => {
      const now = new Date();
      const oldTimestamp = new Date(now.getTime() - (25 * 60 * 60 * 1000)).toISOString();
      const recentTimestamp = new Date(now.getTime() - (1 * 60 * 60 * 1000)).toISOString();

      repo.appendMessage('+5511999999999', {
        role: 'user',
        content: 'Old',
        timestamp: oldTimestamp
      });
      repo.appendMessage('+5511999999999', {
        role: 'assistant',
        content: 'Recent',
        timestamp: recentTimestamp
      });

      repo.cleanup();

      const conv = repo.getOrCreateConversation('+5511999999999');
      expect(conv.lastMessageAt).toBe(recentTimestamp);
    });

    it('respects custom retention hours', () => {
      const shortRepo = new StateRepository({ retentionHours: 1 });
      const now = new Date();
      const twoHoursAgo = new Date(now.getTime() - (2 * 60 * 60 * 1000)).toISOString();
      const thirtyMinAgo = new Date(now.getTime() - (30 * 60 * 1000)).toISOString();

      shortRepo.appendMessage('+5511999999999', {
        role: 'user',
        content: 'Too old for 1h retention',
        timestamp: twoHoursAgo
      });
      shortRepo.appendMessage('+5511999999999', {
        role: 'user',
        content: 'Within 1h retention',
        timestamp: thirtyMinAgo
      });

      shortRepo.cleanup();

      const history = shortRepo.getHistory('+5511999999999', 100);
      expect(history).toHaveLength(1);
      expect(history[0].content).toBe('Within 1h retention');
    });

    it('enforces minimum retention of 1 hour', () => {
      const tinyRepo = new StateRepository({ retentionHours: 0 });
      expect(tinyRepo.retentionHours).toBe(1);
    });

    it('enforces maximum retention of 168 hours', () => {
      const bigRepo = new StateRepository({ retentionHours: 500 });
      expect(bigRepo.retentionHours).toBe(168);
    });
  });

  describe('startCleanupInterval / stopCleanupInterval', () => {
    it('starts a cleanup interval', () => {
      repo.startCleanupInterval();
      expect(repo._cleanupInterval).not.toBeNull();
    });

    it('stops the cleanup interval', () => {
      repo.startCleanupInterval();
      repo.stopCleanupInterval();
      expect(repo._cleanupInterval).toBeNull();
    });

    it('restarts the interval if called again', () => {
      repo.startCleanupInterval();
      const firstInterval = repo._cleanupInterval;

      repo.startCleanupInterval();
      const secondInterval = repo._cleanupInterval;

      expect(secondInterval).not.toBe(firstInterval);
    });

    it('stopCleanupInterval is safe to call when no interval is running', () => {
      expect(() => repo.stopCleanupInterval()).not.toThrow();
    });

    it('calls cleanup periodically', () => {
      jest.useFakeTimers();
      const cleanupSpy = jest.spyOn(repo, 'cleanup');

      repo.startCleanupInterval();

      jest.advanceTimersByTime(60 * 1000);
      expect(cleanupSpy).toHaveBeenCalledTimes(1);

      jest.advanceTimersByTime(60 * 1000);
      expect(cleanupSpy).toHaveBeenCalledTimes(2);

      repo.stopCleanupInterval();
      jest.useRealTimers();
    });
  });
});
