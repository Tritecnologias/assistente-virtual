'use strict';

const { HandoffController } = require('../../src/controllers/handoffController');

describe('HandoffController', () => {
  let controller;
  let mockStateRepository;
  let mockMessageDispatcher;
  let config;

  beforeEach(() => {
    config = {
      handoff: {
        triggerKeywords: ['falar com atendente', 'quero cancelar', 'reclamação', 'humano']
      }
    };

    mockStateRepository = {
      getControlMode: jest.fn().mockReturnValue('AI'),
      setControlMode: jest.fn()
    };

    mockMessageDispatcher = {
      sendMessage: jest.fn().mockResolvedValue(undefined)
    };

    controller = new HandoffController(config, mockStateRepository, mockMessageDispatcher);
  });

  describe('containsTrigger', () => {
    it('should return true when message contains any trigger keyword', () => {
      expect(controller.containsTrigger('Quero falar com atendente')).toBe(true);
      expect(controller.containsTrigger('quero cancelar meu pedido')).toBe(true);
      expect(controller.containsTrigger('tenho uma reclamação')).toBe(true);
    });

    it('should be case-insensitive', () => {
      expect(controller.containsTrigger('FALAR COM ATENDENTE')).toBe(true);
      expect(controller.containsTrigger('Reclamação')).toBe(true);
      expect(controller.containsTrigger('QUERO CANCELAR')).toBe(true);
    });

    it('should return true when trigger is a substring', () => {
      expect(controller.containsTrigger('Olá, gostaria de falar com atendente por favor')).toBe(true);
    });

    it('should return false when message does not contain any trigger', () => {
      expect(controller.containsTrigger('Quero comprar um produto')).toBe(false);
    });

    it('should return false for empty string', () => {
      expect(controller.containsTrigger('')).toBe(false);
    });

    it('should return false for null or undefined', () => {
      expect(controller.containsTrigger(null)).toBe(false);
      expect(controller.containsTrigger(undefined)).toBe(false);
    });

    it('should return false for non-string values', () => {
      expect(controller.containsTrigger(123)).toBe(false);
      expect(controller.containsTrigger({})).toBe(false);
    });

    it('should match multiple different triggers', () => {
      const ctrl = new HandoffController(
        { handoff: { triggerKeywords: ['help', 'support', 'agent'] } },
        mockStateRepository,
        mockMessageDispatcher
      );
      expect(ctrl.containsTrigger('I need help please')).toBe(true);
      expect(ctrl.containsTrigger('contact support')).toBe(true);
      expect(ctrl.containsTrigger('talk to agent')).toBe(true);
      expect(ctrl.containsTrigger('hello world')).toBe(false);
    });

    it('should work with legacy single triggerKeyword config', () => {
      const ctrl = new HandoffController(
        { handoff: { triggerKeyword: 'humano' } },
        mockStateRepository,
        mockMessageDispatcher
      );
      expect(ctrl.containsTrigger('quero um humano')).toBe(true);
      expect(ctrl.containsTrigger('hello')).toBe(false);
    });
  });

  describe('pauseAI', () => {
    it('should set mode to Human and send notification when currently in AI mode', async () => {
      mockStateRepository.getControlMode.mockReturnValue('AI');

      const result = await controller.pauseAI('+5511999999999');

      expect(result).toEqual({ changed: true });
      expect(mockStateRepository.setControlMode).toHaveBeenCalledWith('+5511999999999', 'Human');
      expect(mockMessageDispatcher.sendMessage).toHaveBeenCalledWith(
        '+5511999999999',
        'Um atendente humano vai continuar essa conversa. Aguarde um momento! 😊'
      );
    });

    it('should return { changed: false } when already in Human mode', async () => {
      mockStateRepository.getControlMode.mockReturnValue('Human');

      const result = await controller.pauseAI('+5511999999999');

      expect(result).toEqual({ changed: false });
      expect(mockStateRepository.setControlMode).not.toHaveBeenCalled();
      expect(mockMessageDispatcher.sendMessage).not.toHaveBeenCalled();
    });

    it('should not send duplicate notification when already paused', async () => {
      mockStateRepository.getControlMode.mockReturnValue('Human');

      await controller.pauseAI('+5511999999999');
      await controller.pauseAI('+5511999999999');

      expect(mockMessageDispatcher.sendMessage).not.toHaveBeenCalled();
    });
  });

  describe('resumeAI', () => {
    it('should set mode to AI and send notification when currently in Human mode', async () => {
      mockStateRepository.getControlMode.mockReturnValue('Human');

      const result = await controller.resumeAI('+5511999999999');

      expect(result).toEqual({ changed: true });
      expect(mockStateRepository.setControlMode).toHaveBeenCalledWith('+5511999999999', 'AI');
      expect(mockMessageDispatcher.sendMessage).toHaveBeenCalledWith(
        '+5511999999999',
        'A Lara voltou! Como posso te ajudar? 💜'
      );
    });

    it('should return { changed: false } when already in AI mode', async () => {
      mockStateRepository.getControlMode.mockReturnValue('AI');

      const result = await controller.resumeAI('+5511999999999');

      expect(result).toEqual({ changed: false });
      expect(mockStateRepository.setControlMode).not.toHaveBeenCalled();
      expect(mockMessageDispatcher.sendMessage).not.toHaveBeenCalled();
    });

    it('should not send duplicate notification when already in AI mode', async () => {
      mockStateRepository.getControlMode.mockReturnValue('AI');

      await controller.resumeAI('+5511999999999');
      await controller.resumeAI('+5511999999999');

      expect(mockMessageDispatcher.sendMessage).not.toHaveBeenCalled();
    });
  });
});
