'use strict';

const { DashboardController } = require('../../src/controllers/dashboardController');

describe('DashboardController', () => {
  let controller;
  let mockStateRepository;
  let mockHandoffController;
  let mockReq;
  let mockRes;

  beforeEach(() => {
    mockStateRepository = {
      getActiveConversations: jest.fn()
    };

    mockHandoffController = {
      pauseAI: jest.fn(),
      resumeAI: jest.fn()
    };

    controller = new DashboardController(mockStateRepository, mockHandoffController);

    mockRes = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis()
    };

    mockReq = {
      params: {}
    };
  });

  describe('getConversations', () => {
    it('should return active conversations with HTTP 200', async () => {
      const conversations = [
        { phoneNumber: '5511999990001', controlMode: 'AI', lastMessageAt: '2024-01-01T12:00:00.000Z', messageCount: 5 },
        { phoneNumber: '5511999990002', controlMode: 'Human', lastMessageAt: '2024-01-01T11:00:00.000Z', messageCount: 3 }
      ];
      mockStateRepository.getActiveConversations.mockReturnValue(conversations);

      await controller.getConversations(mockReq, mockRes);

      expect(mockStateRepository.getActiveConversations).toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith(conversations);
    });

    it('should return empty array when no active conversations', async () => {
      mockStateRepository.getActiveConversations.mockReturnValue([]);

      await controller.getConversations(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith([]);
    });

    it('should return HTTP 500 if stateRepository throws', async () => {
      mockStateRepository.getActiveConversations.mockImplementation(() => {
        throw new Error('Storage failure');
      });

      await controller.getConversations(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Failed to retrieve conversations' });
    });
  });

  describe('pauseConversation', () => {
    it('should pause AI and return result with HTTP 200', async () => {
      mockReq.params.phone = '5511999990001';
      mockHandoffController.pauseAI.mockResolvedValue({ changed: true });

      await controller.pauseConversation(mockReq, mockRes);

      expect(mockHandoffController.pauseAI).toHaveBeenCalledWith('5511999990001');
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({ changed: true });
    });

    it('should return { changed: false } when already in Human mode', async () => {
      mockReq.params.phone = '5511999990002';
      mockHandoffController.pauseAI.mockResolvedValue({ changed: false });

      await controller.pauseConversation(mockReq, mockRes);

      expect(mockHandoffController.pauseAI).toHaveBeenCalledWith('5511999990002');
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({ changed: false });
    });

    it('should return HTTP 500 if handoffController.pauseAI throws', async () => {
      mockReq.params.phone = '5511999990001';
      mockHandoffController.pauseAI.mockRejectedValue(new Error('Dispatch failed'));

      await controller.pauseConversation(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Failed to pause conversation' });
    });
  });

  describe('resumeConversation', () => {
    it('should resume AI and return result with HTTP 200', async () => {
      mockReq.params.phone = '5511999990001';
      mockHandoffController.resumeAI.mockResolvedValue({ changed: true });

      await controller.resumeConversation(mockReq, mockRes);

      expect(mockHandoffController.resumeAI).toHaveBeenCalledWith('5511999990001');
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({ changed: true });
    });

    it('should return { changed: false } when already in AI mode', async () => {
      mockReq.params.phone = '5511999990002';
      mockHandoffController.resumeAI.mockResolvedValue({ changed: false });

      await controller.resumeConversation(mockReq, mockRes);

      expect(mockHandoffController.resumeAI).toHaveBeenCalledWith('5511999990002');
      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(mockRes.json).toHaveBeenCalledWith({ changed: false });
    });

    it('should return HTTP 500 if handoffController.resumeAI throws', async () => {
      mockReq.params.phone = '5511999990001';
      mockHandoffController.resumeAI.mockRejectedValue(new Error('Dispatch failed'));

      await controller.resumeConversation(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'Failed to resume conversation' });
    });
  });
});
