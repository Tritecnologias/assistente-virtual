'use strict';

const axios = require('axios');

/**
 * Fallback message sent when the AI Engine cannot generate a response.
 */
const FALLBACK_MESSAGE = "I'm temporarily unavailable. A human agent will assist you shortly.";

/**
 * Maximum number of messages to include in context.
 */
const MAX_CONTEXT_MESSAGES = 20;

/**
 * Maximum tokens for conversation history portion (~4 chars per token).
 */
const MAX_HISTORY_TOKENS = 3000;

/**
 * Characters per token estimate for truncation calculations.
 */
const CHARS_PER_TOKEN = 4;

/**
 * Maximum response length in characters.
 */
const MAX_RESPONSE_LENGTH = 4096;

/**
 * AIEngine manages interaction with the OpenAI GPT-4 API,
 * including context preparation, history truncation, and retry logic.
 */
class AIEngine {
  /**
   * @param {object} config - Configuration object
   * @param {object} config.openai - OpenAI configuration
   * @param {string} config.openai.apiKey - OpenAI API key
   * @param {string} config.openai.model - Model name (e.g., 'gpt-4')
   * @param {number} config.openai.timeout - Request timeout in milliseconds (default: 30000)
   * @param {string} config.systemPrompt - System prompt for the AI
   * @param {object} stateRepository - StateRepository instance
   */
  constructor(config, stateRepository) {
    this.apiKey = config.openai.apiKey;
    this.model = config.openai.model || 'gpt-4';
    this.timeout = config.openai.timeout || 30000;
    this.systemPrompt = config.systemPrompt;
    this.stateRepository = stateRepository;
  }

  /**
   * Generates an AI response for a conversation.
   * Retrieves conversation history, sends to OpenAI with system prompt,
   * stores the response, and returns it.
   *
   * Implements retry logic: retries once on error/timeout.
   * If both attempts fail, logs the error and returns a fallback message.
   *
   * @param {string} phoneNumber - Conversation identifier
   * @param {string} incomingMessage - The new user message
   * @returns {Promise<string>} Generated response text (max 4096 chars)
   */
  async generateResponse(phoneNumber, incomingMessage) {
    // Get conversation history (up to 20 messages)
    const history = this.stateRepository.getHistory(phoneNumber, MAX_CONTEXT_MESSAGES);

    // Prepare the context (system prompt + truncated history)
    const messages = this.prepareContext(history, this.systemPrompt);

    // Attempt to call OpenAI API with retry logic
    let response = null;
    let lastError = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        response = await this._callOpenAI(messages);
        break;
      } catch (error) {
        lastError = error;
        if (attempt === 0) {
          console.error(`[AIEngine] First attempt failed for ${phoneNumber}: ${error.message}. Retrying...`);
        }
      }
    }

    // If both attempts failed, log and return fallback
    if (response === null) {
      console.error(`[AIEngine] All attempts failed for ${phoneNumber}: ${lastError.message}`);
      return FALLBACK_MESSAGE;
    }

    // Handle empty response body
    if (!response || response.trim().length === 0) {
      console.error(`[AIEngine] Empty response received from OpenAI for ${phoneNumber}`);
      return FALLBACK_MESSAGE;
    }

    // Truncate response to 4096 characters if it exceeds that length
    let finalResponse = response;
    if (finalResponse.length > MAX_RESPONSE_LENGTH) {
      finalResponse = finalResponse.substring(0, MAX_RESPONSE_LENGTH);
    }

    // Store AI response in conversation history
    this.stateRepository.appendMessage(phoneNumber, {
      role: 'assistant',
      content: finalResponse,
      timestamp: new Date().toISOString()
    });

    return finalResponse;
  }

  /**
   * Prepares the message array for the OpenAI API.
   * Builds an array with the system prompt followed by truncated conversation history.
   *
   * @param {object[]} history - Conversation history (up to 20 messages)
   * @param {string} systemPrompt - The system prompt
   * @returns {object[]} OpenAI messages array with { role, content } objects
   */
  prepareContext(history, systemPrompt) {
    const messages = [];

    // Add system prompt as the first message
    messages.push({
      role: 'system',
      content: systemPrompt
    });

    // Limit to max 20 messages
    let contextMessages = history;
    if (contextMessages.length > MAX_CONTEXT_MESSAGES) {
      contextMessages = contextMessages.slice(-MAX_CONTEXT_MESSAGES);
    }

    // Truncate history to fit within token limit
    const truncatedMessages = this.truncateHistory(contextMessages, MAX_HISTORY_TOKENS);

    // Add truncated history messages
    for (const msg of truncatedMessages) {
      messages.push({
        role: msg.role,
        content: msg.content
      });
    }

    return messages;
  }

  /**
   * Truncates conversation history to fit within the specified token limit.
   * Preserves the most recent messages in chronological order.
   * Uses an estimate of ~4 characters per token.
   *
   * @param {object[]} messages - Messages to truncate (in chronological order)
   * @param {number} [maxTokens=3000] - Maximum token count for the history
   * @returns {object[]} Truncated message list in chronological order
   */
  truncateHistory(messages, maxTokens = MAX_HISTORY_TOKENS) {
    if (!messages || messages.length === 0) {
      return [];
    }

    const maxChars = maxTokens * CHARS_PER_TOKEN;

    // Calculate total characters
    let totalChars = 0;
    for (const msg of messages) {
      totalChars += (msg.content || '').length;
    }

    // If within limit, return all messages
    if (totalChars <= maxChars) {
      return [...messages];
    }

    // Remove oldest messages until we fit within the limit.
    // Preserve most recent messages in chronological order.
    const result = [];
    let currentChars = 0;

    // Iterate from most recent to oldest, collecting messages that fit
    for (let i = messages.length - 1; i >= 0; i--) {
      const msgChars = (messages[i].content || '').length;
      if (currentChars + msgChars <= maxChars) {
        result.unshift(messages[i]);
        currentChars += msgChars;
      } else {
        // Once we can't fit the next oldest message, stop
        break;
      }
    }

    return result;
  }

  /**
   * Makes the actual HTTP call to the OpenAI Chat Completions API.
   *
   * @param {object[]} messages - The messages array for the API
   * @returns {Promise<string>} The response text content
   * @throws {Error} If the request fails or times out
   * @private
   */
  async _callOpenAI(messages) {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: this.model,
        messages
      },
      {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: this.timeout
      }
    );

    // Extract the response text
    const choices = response.data && response.data.choices;
    if (!choices || choices.length === 0) {
      return '';
    }

    const content = choices[0].message && choices[0].message.content;
    return content || '';
  }
}

module.exports = { AIEngine, FALLBACK_MESSAGE, MAX_CONTEXT_MESSAGES, MAX_HISTORY_TOKENS, CHARS_PER_TOKEN, MAX_RESPONSE_LENGTH };
