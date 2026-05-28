'use strict';

const axios = require('axios');

/**
 * Maximum characters allowed per message segment.
 */
const MAX_MESSAGE_LENGTH = 4096;

/**
 * Maximum number of retry attempts for failed requests.
 */
const MAX_RETRIES = 2;

/**
 * Delay between retry attempts in milliseconds.
 */
const RETRY_DELAY_MS = 2000;

/**
 * Request timeout in milliseconds.
 */
const REQUEST_TIMEOUT_MS = 10000;

/**
 * MessageDispatcher handles sending messages to WhatsApp via the Z-API send endpoint.
 * Supports message splitting for long texts and retry logic for transient failures.
 */
class MessageDispatcher {
  /**
   * @param {object} config - Configuration object
   * @param {object} config.zapi - Z-API configuration
   * @param {string} config.zapi.instanceId - Z-API instance ID
   * @param {string} config.zapi.token - Z-API token
   */
  constructor(config) {
    this.instanceId = config.zapi.instanceId;
    this.token = config.zapi.token;
    this.clientToken = config.zapi.clientToken || null;
    this.baseUrl = `https://api.z-api.io/instances/${this.instanceId}/token/${this.token}/send-text`;
  }

  /**
   * Sends a text message to a phone number via Z-API.
   * If the message exceeds 4096 characters, it is split into sequential segments.
   * Implements retry logic for network errors, timeouts, and HTTP 5xx responses.
   *
   * @param {string} phoneNumber - Recipient phone number (E.164 format)
   * @param {string} text - Message text to send
   * @returns {Promise<void>}
   */
  async sendMessage(phoneNumber, text) {
    const segments = this.splitMessage(text);

    for (const segment of segments) {
      await this._sendWithRetry(phoneNumber, segment);
    }
  }

  /**
   * Splits a long message into segments of max 4096 characters each.
   * If the text is within the limit, returns a single-element array.
   *
   * @param {string} text - Full message text
   * @returns {string[]} Array of message segments
   */
  splitMessage(text) {
    if (!text || text.length === 0) {
      return [''];
    }

    if (text.length <= MAX_MESSAGE_LENGTH) {
      return [text];
    }

    const segments = [];
    let offset = 0;

    while (offset < text.length) {
      segments.push(text.substring(offset, offset + MAX_MESSAGE_LENGTH));
      offset += MAX_MESSAGE_LENGTH;
    }

    return segments;
  }

  /**
   * Sends a single message segment with retry logic.
   * Retries up to 2 additional times (3 total attempts) with 2-second delay
   * for network errors, timeouts, or HTTP 5xx responses.
   * Does NOT retry on HTTP 4xx client errors.
   *
   * @param {string} phoneNumber - Recipient phone number
   * @param {string} text - Message segment text
   * @returns {Promise<void>}
   * @private
   */
  async _sendWithRetry(phoneNumber, text) {
    let lastError = null;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        await this._sendRequest(phoneNumber, text);
        return; // Success
      } catch (error) {
        lastError = error;

        // Do NOT retry on HTTP 4xx client errors
        if (this._isClientError(error)) {
          console.error('[MessageDispatcher] Client error (4xx) - not retrying', {
            phone: phoneNumber,
            content: text,
            error: this._formatError(error)
          });
          throw error;
        }

        // Only retry on network errors, timeouts, or HTTP 5xx
        if (this._isRetryable(error)) {
          if (attempt < MAX_RETRIES) {
            await this._delay(RETRY_DELAY_MS);
          }
        } else {
          // Unknown error type - don't retry
          break;
        }
      }
    }

    // All retries exhausted
    console.error('[MessageDispatcher] All retries exhausted', {
      phone: phoneNumber,
      content: text,
      attempts: MAX_RETRIES + 1,
      error: this._formatError(lastError)
    });
    throw lastError;
  }

  /**
   * Makes the actual HTTP request to the Z-API send endpoint.
   *
   * @param {string} phoneNumber - Recipient phone number
   * @param {string} text - Message text
   * @returns {Promise<object>} Axios response
   * @private
   */
  async _sendRequest(phoneNumber, text) {
    console.log(`[MessageDispatcher] Sending to ${phoneNumber} via ${this.baseUrl}`);
    const headers = { 'Content-Type': 'application/json' };
    if (this.clientToken) {
      headers['Client-Token'] = this.clientToken;
    }
    const response = await axios.post(
      this.baseUrl,
      {
        phone: phoneNumber,
        message: text
      },
      {
        timeout: REQUEST_TIMEOUT_MS,
        headers
      }
    );

    console.log(`[MessageDispatcher] Z-API response:`, response.status, JSON.stringify(response.data));
    return response;
  }

  /**
   * Determines if an error is an HTTP 4xx client error.
   *
   * @param {Error} error - The error to check
   * @returns {boolean} True if it's a 4xx error
   * @private
   */
  _isClientError(error) {
    if (error.response && error.response.status >= 400 && error.response.status < 500) {
      return true;
    }
    return false;
  }

  /**
   * Determines if an error is retryable (network error, timeout, or HTTP 5xx).
   *
   * @param {Error} error - The error to check
   * @returns {boolean} True if the error is retryable
   * @private
   */
  _isRetryable(error) {
    // Network errors (no response received)
    if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT' || error.code === 'ECONNRESET' || error.code === 'ENOTFOUND' || error.code === 'ENETUNREACH') {
      return true;
    }

    // Axios timeout
    if (error.message && error.message.includes('timeout')) {
      return true;
    }

    // HTTP 5xx server errors
    if (error.response && error.response.status >= 500) {
      return true;
    }

    // No response (network failure)
    if (error.request && !error.response) {
      return true;
    }

    return false;
  }

  /**
   * Formats an error for logging purposes.
   *
   * @param {Error} error - The error to format
   * @returns {object} Formatted error details
   * @private
   */
  _formatError(error) {
    const formatted = {
      message: error.message
    };

    if (error.code) {
      formatted.code = error.code;
    }

    if (error.response) {
      formatted.status = error.response.status;
      formatted.statusText = error.response.statusText;
      formatted.data = error.response.data;
    }

    return formatted;
  }

  /**
   * Delays execution for the specified duration.
   *
   * @param {number} ms - Milliseconds to delay
   * @returns {Promise<void>}
   * @private
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = MessageDispatcher;
