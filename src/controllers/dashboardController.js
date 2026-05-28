'use strict';

/**
 * DashboardController serves the dashboard API endpoints for the monitoring interface.
 *
 * Responsibilities:
 * - GET /api/conversations: Returns active conversations sorted by last message descending
 * - POST /api/conversations/:phone/pause: Triggers handoff to set mode to "Human"
 * - POST /api/conversations/:phone/resume: Triggers handoff to set mode to "AI"
 */
class DashboardController {
  /**
   * @param {object} stateRepository - StateRepository instance
   * @param {object} handoffController - HandoffController instance
   */
  constructor(stateRepository, handoffController) {
    this.stateRepository = stateRepository;
    this.handoffController = handoffController;
  }

  /**
   * GET /api/conversations
   * Returns active conversations with phone, controlMode, lastMessageAt, messageCount.
   * Sorted by last message timestamp descending (most recent first).
   *
   * @param {object} req - Express request
   * @param {object} res - Express response
   */
  async getConversations(req, res) {
    try {
      const conversations = this.stateRepository.getActiveConversations();
      res.status(200).json(conversations);
    } catch (error) {
      console.error(`[DashboardController] Failed to get conversations: ${error.message}`);
      res.status(500).json({ error: 'Failed to retrieve conversations' });
    }
  }

  /**
   * POST /api/conversations/:phone/pause
   * Triggers Handoff Controller to set mode to "Human".
   * Returns error response if mode change fails.
   *
   * @param {object} req - Express request with params.phone
   * @param {object} res - Express response
   */
  async pauseConversation(req, res) {
    try {
      const { phone } = req.params;
      const result = await this.handoffController.pauseAI(phone);
      res.status(200).json(result);
    } catch (error) {
      console.error(`[DashboardController] Failed to pause conversation: ${error.message}`);
      res.status(500).json({ error: 'Failed to pause conversation' });
    }
  }

  /**
   * POST /api/conversations/:phone/resume
   * Triggers Handoff Controller to set mode to "AI".
   * Returns error response if mode change fails.
   *
   * @param {object} req - Express request with params.phone
   * @param {object} res - Express response
   */
  async resumeConversation(req, res) {
    try {
      const { phone } = req.params;
      const result = await this.handoffController.resumeAI(phone);
      res.status(200).json(result);
    } catch (error) {
      console.error(`[DashboardController] Failed to resume conversation: ${error.message}`);
      res.status(500).json({ error: 'Failed to resume conversation' });
    }
  }
}

module.exports = { DashboardController };
