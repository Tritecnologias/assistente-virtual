'use strict';

const axios = require('axios');
const { AIEngine, FALLBACK_MESSAGE, MAX_CONTEXT_MESSAGES, MAX_HISTORY_TOKENS, CHARS_PER_TOKEN, MAX_RESPONSE_LENGTH } = require('../../src/services/aiEngine');

jest.mock('axios');

describe('AIEngine', () => {
  let aiEngine;
  let mockStateRepository;
  let config;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});

    mockStateRepository = {
      getHistory: jest.fn().mockReturnValue([]),
      appendMessage: jest.fn()
    };

    config = {
      openai: {
        apiKey: 'test-api-key',
        model: 'gpt-4',
        timeout: 30000
      },
      systemPrompt: 'You are a helpful assistant.'
    };

    aiEngine = new AIEngine(config, mockStateRepository);
  });

  afterEach(() => {
    console.error.mockRestore();
  });

  describe('constructor', () => {
    it('should initialize with provided config values', () => {
      expect(aiEngine.apiKey).toBe('test-api-key');
      expect(aiEngine.model).toBe('gpt-4');
      expect(aiEngine.timeout).toBe(30000);
      expect(aiEngine.systemPrompt).toBe('You are a helpful assistant.');
    });

    it('should use defaults for missing optional config', () => {
      const minimalConfig = {
        openai: { apiKey: 'key' },
        systemPrompt: 'prompt'
      };
      const engine = new AIEngine(minimalConfig, mockStateRepository);
      expect(engine.model).toBe('gpt-4');
      expect(engine.timeout).toBe(30000);
    });
  });

  describe('prepareContext', () => {
    it('should include system prompt as first message', () => {
      const result = aiEngine.prepareContext([], 'System prompt here');
      expect(result[0]).toEqual({ role: 'system', content: 'System prompt here' });
    });

    it('should include history messages after system prompt', () => {
      const history = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' }
      ];
      const result = aiEngine.prepareContext(history, 'System prompt');
      expect(result).toHaveLength(3);
      expect(result[1]).toEqual({ role: 'user', content: 'Hello' });
      expect(result[2]).toEqual({ role: 'assistant', content: 'Hi there!' });
    });

    it('should limit history to 20 messages', () => {
      const history = Array.from({ length: 25 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i}`
      }));
      const result = aiEngine.prepareContext(history, 'System');
      // 1 system + 20 history = 21
      expect(result).toHaveLength(21);
      // Should keep the most recent 20
      expect(result[1].content).toBe('Message 5');
      expect(result[20].content).toBe('Message 24');
    });

    it('should truncate history to fit within token limit', () => {
      // Each message ~3000 chars = ~750 tokens. 5 messages = 3750 tokens > 3000 limit
      const history = Array.from({ length: 5 }, (_, i) => ({
        role: 'user',
        content: 'x'.repeat(3000)
      }));
      const result = aiEngine.prepareContext(history, 'System');
      // Should have system + truncated messages (at most fitting within 3000 tokens = 12000 chars)
      const historyMessages = result.slice(1);
      const totalChars = historyMessages.reduce((sum, m) => sum + m.content.length, 0);
      expect(totalChars).toBeLessThanOrEqual(MAX_HISTORY_TOKENS * CHARS_PER_TOKEN);
    });
  });

  describe('truncateHistory', () => {
    it('should return empty array for empty input', () => {
      expect(aiEngine.truncateHistory([])).toEqual([]);
      expect(aiEngine.truncateHistory(null)).toEqual([]);
    });

    it('should return all messages if within token limit', () => {
      const messages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi' }
      ];
      const result = aiEngine.truncateHistory(messages, 3000);
      expect(result).toHaveLength(2);
      expect(result[0].content).toBe('Hello');
      expect(result[1].content).toBe('Hi');
    });

    it('should preserve most recent messages when truncating', () => {
      // 3000 tokens * 4 chars = 12000 chars max
      const messages = [
        { role: 'user', content: 'a'.repeat(5000) },   // oldest
        { role: 'assistant', content: 'b'.repeat(5000) },
        { role: 'user', content: 'c'.repeat(5000) }    // newest
      ];
      const result = aiEngine.truncateHistory(messages, 3000);
      // 12000 chars limit. Each message is 5000 chars. Can fit 2 messages (10000 chars).
      expect(result).toHaveLength(2);
      // Should keep the most recent two
      expect(result[0].content).toBe('b'.repeat(5000));
      expect(result[1].content).toBe('c'.repeat(5000));
    });

    it('should maintain chronological order after truncation', () => {
      const messages = [
        { role: 'user', content: 'a'.repeat(4000) },
        { role: 'assistant', content: 'b'.repeat(4000) },
        { role: 'user', content: 'c'.repeat(4000) },
        { role: 'assistant', content: 'd'.repeat(4000) }
      ];
      // 12000 chars max, each msg 4000 chars -> can fit 3 messages
      const result = aiEngine.truncateHistory(messages, 3000);
      expect(result).toHaveLength(3);
      expect(result[0].content).toBe('b'.repeat(4000));
      expect(result[1].content).toBe('c'.repeat(4000));
      expect(result[2].content).toBe('d'.repeat(4000));
    });

    it('should handle messages with empty content', () => {
      const messages = [
        { role: 'user', content: '' },
        { role: 'assistant', content: 'Hello' }
      ];
      const result = aiEngine.truncateHistory(messages, 3000);
      expect(result).toHaveLength(2);
    });
  });

  describe('generateResponse', () => {
    it('should generate a response successfully', async () => {
      mockStateRepository.getHistory.mockReturnValue([
        { role: 'user', content: 'Previous message' }
      ]);

      axios.post.mockResolvedValue({
        data: {
          choices: [{ message: { content: 'AI response here' } }]
        }
      });

      const result = await aiEngine.generateResponse('5511999999999', 'Hello');

      expect(result).toBe('AI response here');
      expect(mockStateRepository.getHistory).toHaveBeenCalledWith('5511999999999', 20);
      expect(mockStateRepository.appendMessage).toHaveBeenCalledWith('5511999999999', expect.objectContaining({
        role: 'assistant',
        content: 'AI response here'
      }));
    });

    it('should call OpenAI API with correct parameters', async () => {
      mockStateRepository.getHistory.mockReturnValue([]);
      axios.post.mockResolvedValue({
        data: { choices: [{ message: { content: 'Response' } }] }
      });

      await aiEngine.generateResponse('5511999999999', 'Test');

      expect(axios.post).toHaveBeenCalledWith(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4',
          messages: expect.arrayContaining([
            { role: 'system', content: 'You are a helpful assistant.' }
          ])
        },
        {
          headers: {
            'Authorization': 'Bearer test-api-key',
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );
    });

    it('should retry once on failure and succeed on second attempt', async () => {
      mockStateRepository.getHistory.mockReturnValue([]);
      axios.post
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({
          data: { choices: [{ message: { content: 'Retry success' } }] }
        });

      const result = await aiEngine.generateResponse('5511999999999', 'Hello');

      expect(result).toBe('Retry success');
      expect(axios.post).toHaveBeenCalledTimes(2);
    });

    it('should return fallback message when both attempts fail', async () => {
      mockStateRepository.getHistory.mockReturnValue([]);
      axios.post
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockRejectedValueOnce(new Error('Timeout again'));

      const result = await aiEngine.generateResponse('5511999999999', 'Hello');

      expect(result).toBe(FALLBACK_MESSAGE);
      expect(axios.post).toHaveBeenCalledTimes(2);
      expect(mockStateRepository.appendMessage).not.toHaveBeenCalled();
    });

    it('should return fallback message on empty response', async () => {
      mockStateRepository.getHistory.mockReturnValue([]);
      axios.post.mockResolvedValue({
        data: { choices: [{ message: { content: '' } }] }
      });

      const result = await aiEngine.generateResponse('5511999999999', 'Hello');

      expect(result).toBe(FALLBACK_MESSAGE);
      expect(mockStateRepository.appendMessage).not.toHaveBeenCalled();
    });

    it('should return fallback message when choices array is empty', async () => {
      mockStateRepository.getHistory.mockReturnValue([]);
      axios.post.mockResolvedValue({
        data: { choices: [] }
      });

      const result = await aiEngine.generateResponse('5511999999999', 'Hello');

      expect(result).toBe(FALLBACK_MESSAGE);
    });

    it('should truncate response to 4096 characters', async () => {
      mockStateRepository.getHistory.mockReturnValue([]);
      const longResponse = 'x'.repeat(5000);
      axios.post.mockResolvedValue({
        data: { choices: [{ message: { content: longResponse } }] }
      });

      const result = await aiEngine.generateResponse('5511999999999', 'Hello');

      expect(result).toHaveLength(4096);
      expect(mockStateRepository.appendMessage).toHaveBeenCalledWith('5511999999999', expect.objectContaining({
        content: 'x'.repeat(4096)
      }));
    });

    it('should not truncate response that is exactly 4096 characters', async () => {
      mockStateRepository.getHistory.mockReturnValue([]);
      const exactResponse = 'y'.repeat(4096);
      axios.post.mockResolvedValue({
        data: { choices: [{ message: { content: exactResponse } }] }
      });

      const result = await aiEngine.generateResponse('5511999999999', 'Hello');

      expect(result).toHaveLength(4096);
    });

    it('should store AI response in conversation history', async () => {
      mockStateRepository.getHistory.mockReturnValue([]);
      axios.post.mockResolvedValue({
        data: { choices: [{ message: { content: 'Stored response' } }] }
      });

      await aiEngine.generateResponse('5511999999999', 'Hello');

      expect(mockStateRepository.appendMessage).toHaveBeenCalledWith('5511999999999', {
        role: 'assistant',
        content: 'Stored response',
        timestamp: expect.any(String)
      });
    });

    it('should handle whitespace-only response as empty', async () => {
      mockStateRepository.getHistory.mockReturnValue([]);
      axios.post.mockResolvedValue({
        data: { choices: [{ message: { content: '   \n  ' } }] }
      });

      const result = await aiEngine.generateResponse('5511999999999', 'Hello');

      expect(result).toBe(FALLBACK_MESSAGE);
    });
  });
});
