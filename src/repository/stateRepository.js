'use strict';

const fs = require('fs');
const path = require('path');

/**
 * StateRepository manages in-memory conversation state with file-based persistence.
 * 
 * This class provides core state management for conversations including
 * control mode tracking, message history, conversation lifecycle,
 * deduplication, cleanup, and file-based persistence.
 */
class StateRepository {
  /**
   * @param {object} [config] - Configuration options
   * @param {number} [config.maxMessagesPerConversation=500] - Max messages per conversation
   * @param {number} [config.retentionHours=24] - Hours to retain messages (min 1, max 168)
   * @param {string} [config.filePath] - Path to state.json file (default: data/state.json relative to cwd)
   */
  constructor(config = {}) {
    this.maxMessagesPerConversation = config.maxMessagesPerConversation || 500;

    // Enforce retention hours bounds: min 1h, max 168h, default 24h
    const rawRetention = config.retentionHours != null ? config.retentionHours : 24;
    this.retentionHours = Math.max(1, Math.min(168, rawRetention));

    this.filePath = config.filePath || path.join(process.cwd(), 'data', 'state.json');

    /** @type {Map<string, Conversation>} */
    this.conversations = new Map();

    /** @type {Map<string, number>} messageId -> timestamp (ms) for deduplication */
    this.messageIds = new Map();

    /** @type {NodeJS.Timeout|null} */
    this._cleanupInterval = null;

    /** @type {NodeJS.Timeout|null} */
    this._persistTimer = null;
  }

  /**
   * Gets or creates a conversation record for the given phone number.
   * New conversations are initialized with controlMode "AI".
   * 
   * @param {string} phoneNumber - Conversation identifier (E.164 format)
   * @returns {object} The conversation object
   */
  getOrCreateConversation(phoneNumber) {
    if (this.conversations.has(phoneNumber)) {
      return this.conversations.get(phoneNumber);
    }

    const now = new Date().toISOString();
    const conversation = {
      phoneNumber,
      controlMode: 'AI',
      messages: [],
      lastMessageAt: now,
      createdAt: now
    };

    this.conversations.set(phoneNumber, conversation);
    return conversation;
  }

  /**
   * Gets the control mode for a conversation.
   * If the conversation doesn't exist, creates it with default "AI" mode.
   * 
   * @param {string} phoneNumber - Conversation identifier
   * @returns {"AI" | "Human"} Current control mode
   */
  getControlMode(phoneNumber) {
    const conversation = this.getOrCreateConversation(phoneNumber);
    return conversation.controlMode;
  }

  /**
   * Sets the control mode for a conversation.
   * If the conversation doesn't exist, creates it first.
   * 
   * @param {string} phoneNumber - Conversation identifier
   * @param {"AI" | "Human"} mode - New control mode
   */
  setControlMode(phoneNumber, mode) {
    if (mode !== 'AI' && mode !== 'Human') {
      throw new Error(`Invalid control mode: "${mode}". Must be "AI" or "Human".`);
    }

    const conversation = this.getOrCreateConversation(phoneNumber);
    conversation.controlMode = mode;
    this.schedulePersist();
  }

  /**
   * Appends a message to conversation history.
   * Enforces max 4096 character content limit (truncates if longer).
   * Enforces max 500 messages per conversation (removes oldest when exceeded).
   * 
   * @param {string} phoneNumber - Conversation identifier
   * @param {object} message - Message to append
   * @param {string} message.role - "user" or "assistant"
   * @param {string} message.content - Message text (truncated to 4096 chars)
   * @param {string} [message.timestamp] - ISO 8601 timestamp (defaults to now)
   * @param {string} [message.id] - Unique message identifier (auto-generated if not provided)
   */
  appendMessage(phoneNumber, message) {
    const conversation = this.getOrCreateConversation(phoneNumber);

    // Validate role
    if (message.role !== 'user' && message.role !== 'assistant') {
      throw new Error(`Invalid message role: "${message.role}". Must be "user" or "assistant".`);
    }

    // Truncate content to max 4096 characters
    let content = message.content || '';
    if (content.length > 4096) {
      content = content.substring(0, 4096);
    }

    // Build the stored message
    const storedMessage = {
      id: message.id || this._generateMessageId(),
      role: message.role,
      content,
      timestamp: message.timestamp || new Date().toISOString()
    };

    // Append the message
    conversation.messages.push(storedMessage);

    // Enforce max messages limit — remove oldest when exceeded
    if (conversation.messages.length > this.maxMessagesPerConversation) {
      const excess = conversation.messages.length - this.maxMessagesPerConversation;
      conversation.messages.splice(0, excess);
    }

    // Update last message timestamp
    conversation.lastMessageAt = storedMessage.timestamp;
    this.schedulePersist();
  }

  /**
   * Gets conversation history in chronological order (oldest first).
   * 
   * @param {string} phoneNumber - Conversation identifier
   * @param {number} [limit=20] - Maximum number of messages to return
   * @returns {object[]} Messages in chronological order (oldest first)
   */
  getHistory(phoneNumber, limit = 20) {
    const conversation = this.getOrCreateConversation(phoneNumber);
    const messages = conversation.messages;

    if (messages.length <= limit) {
      return [...messages];
    }

    // Return the most recent `limit` messages in chronological order
    return messages.slice(-limit);
  }

  /**
   * Checks if a message ID has been seen within the 5-minute deduplication window.
   * 
   * @param {string} messageId - The message ID to check
   * @returns {boolean} True if the message is a duplicate (seen within last 5 minutes)
   */
  isDuplicate(messageId) {
    if (!this.messageIds.has(messageId)) {
      return false;
    }

    const recordedAt = this.messageIds.get(messageId);
    const fiveMinutesMs = 5 * 60 * 1000;
    const now = Date.now();

    if (now - recordedAt < fiveMinutesMs) {
      return true;
    }

    // Entry has expired, remove it
    this.messageIds.delete(messageId);
    return false;
  }

  /**
   * Records a message ID with the current timestamp for deduplication tracking.
   * 
   * @param {string} messageId - The message ID to record
   */
  recordMessageId(messageId) {
    this.messageIds.set(messageId, Date.now());
  }

  /**
   * Runs cleanup of expired messages and old deduplication entries.
   * - Removes messages older than the configured retention period from all conversations.
   * - Removes expired deduplication entries (older than 5 minutes).
   */
  cleanup() {
    const now = Date.now();
    const retentionMs = this.retentionHours * 60 * 60 * 1000;
    const deduplicationWindowMs = 5 * 60 * 1000;

    // Clean up expired deduplication entries
    for (const [messageId, timestamp] of this.messageIds.entries()) {
      if (now - timestamp >= deduplicationWindowMs) {
        this.messageIds.delete(messageId);
      }
    }

    // Clean up expired messages from all conversations
    for (const [phoneNumber, conversation] of this.conversations.entries()) {
      const originalLength = conversation.messages.length;
      conversation.messages = conversation.messages.filter(msg => {
        const msgTime = new Date(msg.timestamp).getTime();
        return now - msgTime < retentionMs;
      });

      // Update lastMessageAt if messages were removed and there are remaining messages
      if (conversation.messages.length !== originalLength && conversation.messages.length > 0) {
        const lastMsg = conversation.messages[conversation.messages.length - 1];
        conversation.lastMessageAt = lastMsg.timestamp;
      }
    }
  }

  /**
   * Starts the periodic cleanup interval (every 60 seconds).
   * If an interval is already running, it will be cleared and restarted.
   */
  startCleanupInterval() {
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval);
    }
    this._cleanupInterval = setInterval(() => this.cleanup(), 60 * 1000);

    // Allow the process to exit even if the interval is still active
    if (this._cleanupInterval.unref) {
      this._cleanupInterval.unref();
    }
  }

  /**
   * Stops the periodic cleanup interval.
   */
  stopCleanupInterval() {
    if (this._cleanupInterval) {
      clearInterval(this._cleanupInterval);
      this._cleanupInterval = null;
    }
  }

  /**
   * Schedules a debounced persistence to disk.
   * Ensures state is written within 1 second of a state change.
   * Multiple rapid changes will be batched into a single write.
   */
  schedulePersist() {
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
    }
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null;
      this.persistToDisk();
    }, 1000);

    // Allow the process to exit even if the timer is still active
    if (this._persistTimer.unref) {
      this._persistTimer.unref();
    }
  }

  /**
   * Persists current state to disk using atomic write (write to temp file then rename).
   * Logs errors but does not throw, ensuring message flow is not interrupted.
   */
  async persistToDisk() {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Serialize conversations Map to a plain object
      const conversationsObj = {};
      for (const [phoneNumber, conversation] of this.conversations.entries()) {
        conversationsObj[phoneNumber] = conversation;
      }

      const state = {
        conversations: conversationsObj,
        lastSavedAt: new Date().toISOString(),
        version: 1
      };

      const json = JSON.stringify(state, null, 2);

      // Atomic write: write to temp file then rename
      const tempPath = this.filePath + '.tmp';
      fs.writeFileSync(tempPath, json, 'utf8');
      fs.renameSync(tempPath, this.filePath);
    } catch (error) {
      console.error(`[StateRepository] Failed to persist state to disk: ${error.message}`);
    }
  }

  /**
   * Loads state from disk on startup.
   * If the file doesn't exist, starts with empty state.
   * If the file is corrupted or unreadable, logs error and initializes empty state.
   */
  async loadFromDisk() {
    try {
      if (!fs.existsSync(this.filePath)) {
        return;
      }

      const raw = fs.readFileSync(this.filePath, 'utf8');
      const state = JSON.parse(raw);

      // Validate basic structure
      if (!state || typeof state.conversations !== 'object') {
        throw new Error('Invalid state file structure: missing conversations object');
      }

      // Populate conversations Map from persisted data
      this.conversations.clear();
      for (const [phoneNumber, conversation] of Object.entries(state.conversations)) {
        // Ensure the conversation has required fields
        if (conversation && conversation.phoneNumber && Array.isArray(conversation.messages)) {
          this.conversations.set(phoneNumber, conversation);
        }
      }
    } catch (error) {
      console.error(`[StateRepository] Failed to load state from disk: ${error.message}. Initializing empty state.`);
      this.conversations.clear();
    }
  }

  /**
   * Returns active conversations (those with at least one message within the retention period),
   * sorted by last message timestamp in descending order (most recent first).
   * 
   * @returns {ConversationSummary[]} Array of conversation summaries
   */
  getActiveConversations() {
    const now = Date.now();
    const retentionMs = this.retentionHours * 60 * 60 * 1000;
    const results = [];

    for (const [phoneNumber, conversation] of this.conversations.entries()) {
      // Check if conversation has at least one message within retention period
      const hasActiveMessage = conversation.messages.some(msg => {
        const msgTime = new Date(msg.timestamp).getTime();
        return (now - msgTime) < retentionMs;
      });

      if (hasActiveMessage) {
        results.push({
          phoneNumber: conversation.phoneNumber,
          controlMode: conversation.controlMode,
          lastMessageAt: conversation.lastMessageAt,
          messageCount: conversation.messages.length
        });
      }
    }

    // Sort by lastMessageAt descending (most recent first)
    results.sort((a, b) => {
      const timeA = new Date(a.lastMessageAt).getTime();
      const timeB = new Date(b.lastMessageAt).getTime();
      return timeB - timeA;
    });

    return results;
  }

  /**
   * Generates a unique message ID.
   * @returns {string} A unique identifier
   * @private
   */
  _generateMessageId() {
    return `msg_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }
}

module.exports = { StateRepository };
