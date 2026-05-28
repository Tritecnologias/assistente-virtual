'use strict';

/**
 * HandoffController manages transitions between AI and Human control modes.
 * 
 * Responsibilities:
 * - Detect handoff trigger keywords in incoming messages (case-insensitive substring match)
 * - Pause AI (set mode to "Human") and notify the customer
 * - Resume AI (set mode to "AI") and notify the customer
 * - Prevent duplicate notifications when mode is already in the target state
 */
class HandoffController {
  /**
   * @param {object} config - Application configuration
   * @param {object} config.handoff - Handoff configuration
   * @param {string[]} config.handoff.triggerKeywords - Array of trigger keywords
   * @param {object} stateRepository - StateRepository instance
   * @param {object} messageDispatcher - MessageDispatcher instance
   */
  constructor(config, stateRepository, messageDispatcher) {
    this.triggerKeywords = config.handoff.triggerKeywords || [config.handoff.triggerKeyword];
    this.stateRepository = stateRepository;
    this.messageDispatcher = messageDispatcher;
  }

  /**
   * Checks if a message contains any of the handoff trigger keywords.
   * Uses case-insensitive substring matching against all configured triggers.
   * 
   * @param {string} messageText - The message text to check
   * @returns {boolean} Whether any trigger keyword was found
   */
  containsTrigger(messageText) {
    if (!messageText || typeof messageText !== 'string') {
      return false;
    }

    const lowerMessage = messageText.toLowerCase();
    return this.triggerKeywords.some(keyword => lowerMessage.includes(keyword.toLowerCase()));
  }

  /**
   * Pauses AI for a conversation by setting the control mode to "Human".
   * If the conversation is already in "Human" mode, returns { changed: false }
   * without sending a duplicate notification.
   * 
   * @param {string} phoneNumber - Conversation identifier
   * @returns {Promise<{ changed: boolean }>}
   */
  async pauseAI(phoneNumber) {
    const currentMode = this.stateRepository.getControlMode(phoneNumber);

    if (currentMode === 'Human') {
      return { changed: false };
    }

    this.stateRepository.setControlMode(phoneNumber, 'Human');
    await this.messageDispatcher.sendMessage(phoneNumber, 'Um atendente humano vai continuar essa conversa. Aguarde um momento! 😊');

    return { changed: true };
  }

  /**
   * Resumes AI for a conversation by setting the control mode to "AI".
   * If the conversation is already in "AI" mode, returns { changed: false }
   * without sending a duplicate notification.
   * 
   * @param {string} phoneNumber - Conversation identifier
   * @returns {Promise<{ changed: boolean }>}
   */
  async resumeAI(phoneNumber) {
    const currentMode = this.stateRepository.getControlMode(phoneNumber);

    if (currentMode === 'AI') {
      return { changed: false };
    }

    this.stateRepository.setControlMode(phoneNumber, 'AI');
    await this.messageDispatcher.sendMessage(phoneNumber, 'A Lara voltou! Como posso te ajudar? 💜');

    return { changed: true };
  }
}

module.exports = { HandoffController };
