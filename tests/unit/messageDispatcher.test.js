'use strict';

const axios = require('axios');
const MessageDispatcher = require('../../src/services/messageDispatcher');

jest.mock('axios');

describe('MessageDispatcher', () => {
  let dispatcher;
  const config = {
    zapi: {
      instanceId: 'test-instance-123',
      token: 'test-token-abc'
    }
  };

  beforeEach(() => {
    dispatcher = new MessageDispatcher(config);
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  describe('constructor', () => {
    it('should build the correct Z-API base URL', () => {
      expect(dispatcher.baseUrl).toBe(
        'https://api.z-api.io/instances/test-instance-123/token/test-token-abc/send-text'
      );
    });
  });

  describe('splitMessage', () => {
    it('should return single-element array for short messages', () => {
      const result = dispatcher.splitMessage('Hello world');
      expect(result).toEqual(['Hello world']);
    });

    it('should return single-element array for exactly 4096 characters', () => {
      const text = 'a'.repeat(4096);
      const result = dispatcher.splitMessage(text);
      expect(result).toEqual([text]);
    });

    it('should split messages exceeding 4096 characters', () => {
      const text = 'a'.repeat(8192);
      const result = dispatcher.splitMessage(text);
      expect(result).toHaveLength(2);
      expect(result[0]).toHaveLength(4096);
      expect(result[1]).toHaveLength(4096);
    });

    it('should handle messages that split unevenly', () => {
      const text = 'a'.repeat(5000);
      const result = dispatcher.splitMessage(text);
      expect(result).toHaveLength(2);
      expect(result[0]).toHaveLength(4096);
      expect(result[1]).toHaveLength(904);
      expect(result[0] + result[1]).toBe(text);
    });

    it('should handle empty string', () => {
      const result = dispatcher.splitMessage('');
      expect(result).toEqual(['']);
    });

    it('should preserve concatenation of segments equals original', () => {
      const text = 'x'.repeat(12288);
      const result = dispatcher.splitMessage(text);
      expect(result).toHaveLength(3);
      expect(result.join('')).toBe(text);
    });
  });

  describe('sendMessage', () => {
    it('should send a single message for short text', async () => {
      axios.post.mockResolvedValueOnce({ status: 200, data: { success: true } });

      await dispatcher.sendMessage('5511999999999', 'Hello');

      expect(axios.post).toHaveBeenCalledTimes(1);
      expect(axios.post).toHaveBeenCalledWith(
        dispatcher.baseUrl,
        { phone: '5511999999999', message: 'Hello' },
        { timeout: 10000, headers: { 'Content-Type': 'application/json' } }
      );
    });

    it('should send multiple segments for long messages', async () => {
      axios.post.mockResolvedValue({ status: 200, data: { success: true } });

      const text = 'a'.repeat(8192);
      await dispatcher.sendMessage('5511999999999', text);

      expect(axios.post).toHaveBeenCalledTimes(2);
    });

    it('should send segments in sequential order', async () => {
      const calls = [];
      axios.post.mockImplementation((url, body) => {
        calls.push(body.message);
        return Promise.resolve({ status: 200, data: { success: true } });
      });

      const text = 'A'.repeat(4096) + 'B'.repeat(4096);
      await dispatcher.sendMessage('5511999999999', text);

      expect(calls[0]).toBe('A'.repeat(4096));
      expect(calls[1]).toBe('B'.repeat(4096));
    });
  });

  describe('retry logic', () => {
    it('should retry on network errors', async () => {
      const networkError = new Error('Network Error');
      networkError.request = {};
      // No response property means network failure

      axios.post
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce({ status: 200, data: { success: true } });

      await dispatcher.sendMessage('5511999999999', 'Hello');

      expect(axios.post).toHaveBeenCalledTimes(2);
    });

    it('should retry on timeout errors', async () => {
      const timeoutError = new Error('timeout of 10000ms exceeded');
      timeoutError.code = 'ECONNABORTED';

      axios.post
        .mockRejectedValueOnce(timeoutError)
        .mockResolvedValueOnce({ status: 200, data: { success: true } });

      await dispatcher.sendMessage('5511999999999', 'Hello');

      expect(axios.post).toHaveBeenCalledTimes(2);
    });

    it('should retry on HTTP 5xx errors', async () => {
      const serverError = new Error('Internal Server Error');
      serverError.response = { status: 500, statusText: 'Internal Server Error', data: {} };

      axios.post
        .mockRejectedValueOnce(serverError)
        .mockResolvedValueOnce({ status: 200, data: { success: true } });

      await dispatcher.sendMessage('5511999999999', 'Hello');

      expect(axios.post).toHaveBeenCalledTimes(2);
    });

    it('should retry up to 2 additional times (3 total attempts)', async () => {
      const serverError = new Error('Service Unavailable');
      serverError.response = { status: 503, statusText: 'Service Unavailable', data: {} };

      axios.post.mockRejectedValue(serverError);

      await expect(dispatcher.sendMessage('5511999999999', 'Hello')).rejects.toThrow();

      expect(axios.post).toHaveBeenCalledTimes(3);
    });

    it('should NOT retry on HTTP 4xx client errors', async () => {
      const clientError = new Error('Bad Request');
      clientError.response = { status: 400, statusText: 'Bad Request', data: { error: 'invalid phone' } };

      axios.post.mockRejectedValueOnce(clientError);

      await expect(dispatcher.sendMessage('5511999999999', 'Hello')).rejects.toThrow();

      expect(axios.post).toHaveBeenCalledTimes(1);
    });

    it('should NOT retry on HTTP 403 Forbidden', async () => {
      const forbiddenError = new Error('Forbidden');
      forbiddenError.response = { status: 403, statusText: 'Forbidden', data: {} };

      axios.post.mockRejectedValueOnce(forbiddenError);

      await expect(dispatcher.sendMessage('5511999999999', 'Hello')).rejects.toThrow();

      expect(axios.post).toHaveBeenCalledTimes(1);
    });

    it('should NOT retry on HTTP 404 Not Found', async () => {
      const notFoundError = new Error('Not Found');
      notFoundError.response = { status: 404, statusText: 'Not Found', data: {} };

      axios.post.mockRejectedValueOnce(notFoundError);

      await expect(dispatcher.sendMessage('5511999999999', 'Hello')).rejects.toThrow();

      expect(axios.post).toHaveBeenCalledTimes(1);
    });

    it('should log failure with phone, content, and error on 4xx', async () => {
      const clientError = new Error('Bad Request');
      clientError.response = { status: 400, statusText: 'Bad Request', data: { error: 'invalid' } };

      axios.post.mockRejectedValueOnce(clientError);

      await expect(dispatcher.sendMessage('5511999999999', 'Test message')).rejects.toThrow();

      expect(console.error).toHaveBeenCalledWith(
        '[MessageDispatcher] Client error (4xx) - not retrying',
        expect.objectContaining({
          phone: '5511999999999',
          content: 'Test message',
          error: expect.objectContaining({
            message: 'Bad Request',
            status: 400
          })
        })
      );
    });

    it('should log failure with full context when all retries exhausted', async () => {
      const serverError = new Error('Service Unavailable');
      serverError.response = { status: 503, statusText: 'Service Unavailable', data: {} };

      axios.post.mockRejectedValue(serverError);

      await expect(dispatcher.sendMessage('5511999999999', 'Retry test')).rejects.toThrow();

      expect(console.error).toHaveBeenCalledWith(
        '[MessageDispatcher] All retries exhausted',
        expect.objectContaining({
          phone: '5511999999999',
          content: 'Retry test',
          attempts: 3,
          error: expect.objectContaining({
            message: 'Service Unavailable',
            status: 503
          })
        })
      );
    });

    it('should retry on ECONNRESET errors', async () => {
      const resetError = new Error('Connection reset');
      resetError.code = 'ECONNRESET';

      axios.post
        .mockRejectedValueOnce(resetError)
        .mockResolvedValueOnce({ status: 200, data: { success: true } });

      await dispatcher.sendMessage('5511999999999', 'Hello');

      expect(axios.post).toHaveBeenCalledTimes(2);
    });

    it('should retry on ETIMEDOUT errors', async () => {
      const timedoutError = new Error('Connection timed out');
      timedoutError.code = 'ETIMEDOUT';

      axios.post
        .mockRejectedValueOnce(timedoutError)
        .mockResolvedValueOnce({ status: 200, data: { success: true } });

      await dispatcher.sendMessage('5511999999999', 'Hello');

      expect(axios.post).toHaveBeenCalledTimes(2);
    });
  });
});
