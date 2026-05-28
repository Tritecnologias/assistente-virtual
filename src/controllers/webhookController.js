'use strict';

const crypto = require('crypto');

/**
 * Non-text message types that should be acknowledged but not processed by AI.
 */
const NON_TEXT_FIELDS = ['image', 'audio', 'video', 'document', 'sticker', 'location'];

/**
 * WebhookController handles incoming Z-API webhook payloads.
 * 
 * Responsibilities:
 * - Validate webhook signatures (HMAC-SHA256)
 * - Validate payload fields (phone, message text, timestamp)
 * - Filter non-text message types (acknowledge with 200, skip AI)
 * - Deduplicate messages
 * - Route messages based on control mode (AI vs Human)
 * - Detect handoff triggers and invoke Handoff Controller
 * - Respond within 5 seconds to prevent Z-API timeout retries
 */
class WebhookController {
  /**
   * @param {object} config - Application configuration
   * @param {object} config.zapi - Z-API configuration
   * @param {string} config.zapi.webhookSecret - Webhook secret for signature validation
   * @param {object} stateRepository - StateRepository instance
   * @param {object} aiEngine - AIEngine instance
   * @param {object} handoffController - HandoffController instance
   */
  constructor(config, stateRepository, aiEngine, handoffController, messageDispatcher) {
    this.webhookSecret = config.zapi.webhookSecret || null;
    this.stateRepository = stateRepository;
    this.aiEngine = aiEngine;
    this.handoffController = handoffController;
    this.messageDispatcher = messageDispatcher;
  }

  /**
   * Main request handler for POST /webhook.
   * Validates signature and payload, then routes the message appropriately.
   * Responds quickly (within 5 seconds) and processes AI asynchronously if needed.
   * 
   * @param {object} req - Express request object
   * @param {object} res - Express response object
   */
  async handleWebhook(req, res) {
    const payload = req.body;
    const signature = req.headers['x-webhook-signature'];

    // DEBUG: Log raw payload
    console.log('[WebhookController] Raw payload:', JSON.stringify(payload));

    // 0. If message is from the owner (fromMe: true), auto-pause AI for that conversation
    if (payload.fromMe === true && payload.phone && !payload.isGroup) {
      const phoneNumber = payload.phone.replace(/^\+/, '');
      const currentMode = this.stateRepository.getControlMode(phoneNumber);
      if (currentMode === 'AI') {
        this.stateRepository.getOrCreateConversation(phoneNumber);
        this.stateRepository.setControlMode(phoneNumber, 'Human');
        console.log(`[WebhookController] Owner replied to ${phoneNumber} — auto-paused AI`);
      }
      return res.status(200).json({ status: 'received', action: 'owner-reply', paused: currentMode === 'AI' });
    }

    // 1. Validate signature (skip if no webhook secret configured)
    if (this.webhookSecret && !this.validateSignature(payload, signature)) {
      console.error('[WebhookController] Invalid or missing webhook signature');
      return res.status(400).json({ error: 'Invalid signature' });
    }

    // 2. Check for non-text message types — acknowledge and skip AI processing
    if (this._isNonTextMessage(payload)) {
      return res.status(200).json({ status: 'acknowledged', type: 'non-text' });
    }

    // 3. Validate payload fields
    const validation = this.validatePayload(payload);
    if (!validation.valid) {
      console.error('[WebhookController] Payload validation failed:', validation.errors);
      return res.status(400).json({ error: 'Validation failed', details: validation.errors });
    }

    // 4. Check deduplication
    const messageId = payload.messageId;
    if (messageId && this.stateRepository.isDuplicate(messageId)) {
      return res.status(200).json({ status: 'duplicate' });
    }

    // Record message ID for deduplication
    if (messageId) {
      this.stateRepository.recordMessageId(messageId);
    }

    // Extract message data
    const phoneNumber = payload.phone.replace(/^\+/, '');
    const messageText = payload.text.message;
    const timestamp = payload.momment;

    // 5. Get or create conversation and store the incoming message
    this.stateRepository.getOrCreateConversation(phoneNumber);
    this.stateRepository.appendMessage(phoneNumber, {
      role: 'user',
      content: messageText,
      timestamp: new Date(timestamp).toISOString(),
      id: messageId
    });

    // 6. Check for handoff trigger
    if (this.handoffController.containsTrigger(messageText)) {
      // Trigger handoff (message already stored above)
      // Respond immediately, process handoff asynchronously
      res.status(200).json({ status: 'received', action: 'handoff' });
      
      // Process handoff asynchronously (fire and forget)
      this.handoffController.pauseAI(phoneNumber).catch(err => {
        console.error(`[WebhookController] Handoff failed for ${phoneNumber}:`, err.message);
      });
      return;
    }

    // 7. Route based on control mode
    const controlMode = this.stateRepository.getControlMode(phoneNumber);

    if (controlMode === 'Human') {
      // In Human mode: message already stored, no AI processing
      return res.status(200).json({ status: 'received', mode: 'human' });
    }

    // 8. AI mode: respond immediately, then process AI asynchronously
    res.status(200).json({ status: 'received', mode: 'ai' });

    // Process AI response asynchronously to stay within 5-second response time
    this.aiEngine.generateResponse(phoneNumber, messageText)
      .then(response => {
        // Send the AI response back to the customer via Z-API
        return this.messageDispatcher.sendMessage(phoneNumber, response);
      })
      .catch(err => {
        console.error(`[WebhookController] AI processing failed for ${phoneNumber}:`, err.message);
      });
  }

  /**
   * Validates the webhook signature using HMAC-SHA256.
   * Compares the computed signature against the provided signature header.
   * 
   * @param {object} payload - Raw request body (parsed JSON)
   * @param {string} signature - Signature from the x-webhook-signature header
   * @returns {boolean} Whether the signature is valid
   */
  validateSignature(payload, signature) {
    if (!signature || typeof signature !== 'string') {
      return false;
    }

    if (!payload) {
      return false;
    }

    try {
      const payloadString = JSON.stringify(payload);
      const expectedSignature = crypto
        .createHmac('sha256', this.webhookSecret)
        .update(payloadString)
        .digest('hex');

      // Use timing-safe comparison to prevent timing attacks
      return crypto.timingSafeEqual(
        Buffer.from(signature, 'utf8'),
        Buffer.from(expectedSignature, 'utf8')
      );
    } catch (error) {
      // If comparison fails (e.g., different lengths), signature is invalid
      return false;
    }
  }

  /**
   * Validates required fields in the webhook payload.
   * Returns all validation errors at once (not just the first).
   * 
   * Validates:
   * - phone: E.164 format, 8-15 digits (may have leading +)
   * - text.message: non-empty, 1-4096 characters
   * - momment (timestamp): present and parseable
   * 
   * @param {object} payload - Parsed webhook payload
   * @returns {{ valid: boolean, errors: string[] }}
   */
  validatePayload(payload) {
    const errors = [];

    // Validate phone number (E.164: 8-15 digits, optional leading +)
    if (!payload.phone || typeof payload.phone !== 'string') {
      errors.push('Phone number is required');
    } else {
      const phoneDigits = payload.phone.replace(/^\+/, '');
      if (!/^\d{8,15}$/.test(phoneDigits)) {
        errors.push('Phone number must be in E.164 format (8-15 digits)');
      }
    }

    // Validate message text
    if (!payload.text || typeof payload.text !== 'object') {
      errors.push('Message text is required');
    } else if (payload.text.message === undefined || payload.text.message === null) {
      errors.push('Message text is required');
    } else if (typeof payload.text.message !== 'string') {
      errors.push('Message text must be a string');
    } else if (payload.text.message.length === 0) {
      errors.push('Message text must not be empty');
    } else if (payload.text.message.length > 4096) {
      errors.push('Message text must not exceed 4096 characters');
    }

    // Validate timestamp (momment field from Z-API)
    if (!payload.momment) {
      errors.push('Timestamp (momment) is required');
    } else {
      const parsedDate = new Date(payload.momment);
      if (isNaN(parsedDate.getTime())) {
        errors.push('Timestamp (momment) must be a valid parseable date');
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Checks if the payload represents a non-text message type.
   * Non-text types include: image, audio, video, document, sticker, location.
   * 
   * @param {object} payload - Webhook payload
   * @returns {boolean} True if the message is a non-text type
   * @private
   */
  _isNonTextMessage(payload) {
    // If the payload has any of the non-text fields, it's a non-text message
    for (const field of NON_TEXT_FIELDS) {
      if (payload[field] !== undefined && payload[field] !== null) {
        return true;
      }
    }

    // Also check if there's no text field at all (but has other content indicators)
    if (!payload.text && payload.type) {
      return true;
    }

    return false;
  }
}

module.exports = { WebhookController };
