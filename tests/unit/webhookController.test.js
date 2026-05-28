'use strict';

const crypto = require('crypto');
const { WebhookController } = require('../../src/controllers/webhookController');

// Helper to create a valid signature for a payload
function createSignature(payload, secret) {
  const payloadString = JSON.stringify(payload);
  return crypto.createHmac('sha256', secret).update(payloadString).digest('hex');
}

// Helper to create a mock Express response
function createMockRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(data) {
      res.body = data;
      return res;
    }
  };
  return res;
}

// Helper to create a valid webhook payload
function createValidPayload(overrides = {}) {
  return {
    phone: '5511999887766',
    messageId: 'msg_123456',
    text: { message: 'Hello, I need help' },
    momment: '2024-01-15T10:30:00.000Z',
    type: 'ReceivedCallback',
    isGroup: false,
    ...overrides
  };
}

describe('WebhookController', () => {
  const webhookSecret = 'test-webhook-secret';
  let config;
  let stateRepository;
  let aiEngine;
  let handoffController;
  let controller;

  beforeEach(() => {
    config = {
      zapi: { webhookSecret }
    };

    stateRepository = {
      isDuplicate: jest.fn().mockReturnValue(false),
      recordMessageId: jest.fn(),
      getOrCreateConversation: jest.fn().mockReturnValue({ phoneNumber: '5511999887766', controlMode: 'AI', messages: [] }),
      appendMessage: jest.fn(),
      getControlMode: jest.fn().mockReturnValue('AI')
    };

    aiEngine = {
      generateResponse: jest.fn().mockResolvedValue('AI response')
    };

    handoffController = {
      containsTrigger: jest.fn().mockReturnValue(false),
      pauseAI: jest.fn().mockResolvedValue({ changed: true })
    };

    controller = new WebhookController(config, stateRepository, aiEngine, handoffController);
  });

  describe('validateSignature', () => {
    it('should return true for a valid signature', () => {
      const payload = createValidPayload();
      const signature = createSignature(payload, webhookSecret);
      expect(controller.validateSignature(payload, signature)).toBe(true);
    });

    it('should return false for an invalid signature', () => {
      const payload = createValidPayload();
      const signature = 'invalid-signature-value-that-is-wrong';
      expect(controller.validateSignature(payload, signature)).toBe(false);
    });

    it('should return false for a missing signature', () => {
      const payload = createValidPayload();
      expect(controller.validateSignature(payload, null)).toBe(false);
      expect(controller.validateSignature(payload, undefined)).toBe(false);
      expect(controller.validateSignature(payload, '')).toBe(false);
    });

    it('should return false for a null payload', () => {
      expect(controller.validateSignature(null, 'some-signature')).toBe(false);
    });

    it('should return false when signature has different length than expected', () => {
      const payload = createValidPayload();
      const signature = 'short';
      expect(controller.validateSignature(payload, signature)).toBe(false);
    });
  });

  describe('validatePayload', () => {
    it('should return valid for a correct payload', () => {
      const payload = createValidPayload();
      const result = controller.validatePayload(payload);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject missing phone number', () => {
      const payload = createValidPayload({ phone: undefined });
      delete payload.phone;
      const result = controller.validatePayload(payload);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Phone number is required');
    });

    it('should reject phone number with too few digits', () => {
      const payload = createValidPayload({ phone: '1234567' });
      const result = controller.validatePayload(payload);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Phone number must be in E.164 format (8-15 digits)');
    });

    it('should reject phone number with too many digits', () => {
      const payload = createValidPayload({ phone: '1234567890123456' });
      const result = controller.validatePayload(payload);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Phone number must be in E.164 format (8-15 digits)');
    });

    it('should accept phone number with leading +', () => {
      const payload = createValidPayload({ phone: '+5511999887766' });
      const result = controller.validatePayload(payload);
      expect(result.valid).toBe(true);
    });

    it('should reject missing message text', () => {
      const payload = createValidPayload();
      delete payload.text;
      const result = controller.validatePayload(payload);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Message text is required');
    });

    it('should reject empty message text', () => {
      const payload = createValidPayload({ text: { message: '' } });
      const result = controller.validatePayload(payload);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Message text must not be empty');
    });

    it('should reject message text exceeding 4096 characters', () => {
      const payload = createValidPayload({ text: { message: 'a'.repeat(4097) } });
      const result = controller.validatePayload(payload);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Message text must not exceed 4096 characters');
    });

    it('should accept message text at exactly 4096 characters', () => {
      const payload = createValidPayload({ text: { message: 'a'.repeat(4096) } });
      const result = controller.validatePayload(payload);
      expect(result.valid).toBe(true);
    });

    it('should reject missing timestamp', () => {
      const payload = createValidPayload();
      delete payload.momment;
      const result = controller.validatePayload(payload);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Timestamp (momment) is required');
    });

    it('should reject unparseable timestamp', () => {
      const payload = createValidPayload({ momment: 'not-a-date' });
      const result = controller.validatePayload(payload);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Timestamp (momment) must be a valid parseable date');
    });

    it('should return all validation errors at once', () => {
      const payload = { phone: '123', text: null, momment: null };
      const result = controller.validatePayload(payload);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });
  });

  describe('handleWebhook', () => {
    it('should reject requests with invalid signature when secret is configured', async () => {
      const payload = createValidPayload();
      const req = { body: payload, headers: { 'x-webhook-signature': 'invalid' } };
      const res = createMockRes();

      await controller.handleWebhook(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('Invalid signature');
    });

    it('should skip signature validation when no webhook secret is configured', async () => {
      const noSecretConfig = { zapi: { webhookSecret: null } };
      const noSecretController = new WebhookController(noSecretConfig, stateRepository, aiEngine, handoffController);

      const payload = createValidPayload();
      const req = { body: payload, headers: {} };
      const res = createMockRes();

      stateRepository.getControlMode.mockReturnValue('AI');

      await noSecretController.handleWebhook(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.mode).toBe('ai');
    });

    it('should acknowledge non-text messages with HTTP 200', async () => {
      const payload = createValidPayload();
      payload.image = { imageUrl: 'https://example.com/image.jpg' };
      delete payload.text;
      const signature = createSignature(payload, webhookSecret);
      const req = { body: payload, headers: { 'x-webhook-signature': signature } };
      const res = createMockRes();

      await controller.handleWebhook(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.type).toBe('non-text');
      expect(aiEngine.generateResponse).not.toHaveBeenCalled();
    });

    it('should reject payloads with invalid fields', async () => {
      const payload = { phone: '123', text: { message: '' }, momment: null };
      const signature = createSignature(payload, webhookSecret);
      const req = { body: payload, headers: { 'x-webhook-signature': signature } };
      const res = createMockRes();

      await controller.handleWebhook(req, res);

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('Validation failed');
      expect(res.body.details.length).toBeGreaterThan(0);
    });

    it('should discard duplicate messages with HTTP 200', async () => {
      const payload = createValidPayload();
      const signature = createSignature(payload, webhookSecret);
      const req = { body: payload, headers: { 'x-webhook-signature': signature } };
      const res = createMockRes();

      stateRepository.isDuplicate.mockReturnValue(true);

      await controller.handleWebhook(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.status).toBe('duplicate');
      expect(aiEngine.generateResponse).not.toHaveBeenCalled();
    });

    it('should store message and skip AI when in Human mode', async () => {
      const payload = createValidPayload();
      const signature = createSignature(payload, webhookSecret);
      const req = { body: payload, headers: { 'x-webhook-signature': signature } };
      const res = createMockRes();

      stateRepository.getControlMode.mockReturnValue('Human');

      await controller.handleWebhook(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.mode).toBe('human');
      expect(stateRepository.appendMessage).toHaveBeenCalled();
      expect(aiEngine.generateResponse).not.toHaveBeenCalled();
    });

    it('should forward to AI Engine when in AI mode', async () => {
      const payload = createValidPayload();
      const signature = createSignature(payload, webhookSecret);
      const req = { body: payload, headers: { 'x-webhook-signature': signature } };
      const res = createMockRes();

      stateRepository.getControlMode.mockReturnValue('AI');

      await controller.handleWebhook(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.mode).toBe('ai');
      expect(stateRepository.appendMessage).toHaveBeenCalled();

      // Wait for async processing
      await new Promise(resolve => setImmediate(resolve));
      expect(aiEngine.generateResponse).toHaveBeenCalledWith('5511999887766', 'Hello, I need help');
    });

    it('should detect handoff trigger and invoke Handoff Controller', async () => {
      const payload = createValidPayload({ text: { message: 'I need a human agent' } });
      const signature = createSignature(payload, webhookSecret);
      const req = { body: payload, headers: { 'x-webhook-signature': signature } };
      const res = createMockRes();

      handoffController.containsTrigger.mockReturnValue(true);

      await controller.handleWebhook(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.action).toBe('handoff');
      expect(stateRepository.appendMessage).toHaveBeenCalled();

      // Wait for async processing
      await new Promise(resolve => setImmediate(resolve));
      expect(handoffController.pauseAI).toHaveBeenCalledWith('5511999887766');
      expect(aiEngine.generateResponse).not.toHaveBeenCalled();
    });

    it('should record message ID for deduplication', async () => {
      const payload = createValidPayload();
      const signature = createSignature(payload, webhookSecret);
      const req = { body: payload, headers: { 'x-webhook-signature': signature } };
      const res = createMockRes();

      await controller.handleWebhook(req, res);

      expect(stateRepository.recordMessageId).toHaveBeenCalledWith('msg_123456');
    });

    it('should handle audio non-text message', async () => {
      const payload = { phone: '5511999887766', messageId: 'msg_audio', audio: { audioUrl: 'https://example.com/audio.ogg' }, momment: '2024-01-15T10:30:00.000Z', type: 'ReceivedCallback', isGroup: false };
      const signature = createSignature(payload, webhookSecret);
      const req = { body: payload, headers: { 'x-webhook-signature': signature } };
      const res = createMockRes();

      await controller.handleWebhook(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.type).toBe('non-text');
    });

    it('should handle video non-text message', async () => {
      const payload = { phone: '5511999887766', messageId: 'msg_video', video: { videoUrl: 'https://example.com/video.mp4' }, momment: '2024-01-15T10:30:00.000Z', type: 'ReceivedCallback', isGroup: false };
      const signature = createSignature(payload, webhookSecret);
      const req = { body: payload, headers: { 'x-webhook-signature': signature } };
      const res = createMockRes();

      await controller.handleWebhook(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.type).toBe('non-text');
    });

    it('should handle document non-text message', async () => {
      const payload = { phone: '5511999887766', messageId: 'msg_doc', document: { documentUrl: 'https://example.com/doc.pdf' }, momment: '2024-01-15T10:30:00.000Z', type: 'ReceivedCallback', isGroup: false };
      const signature = createSignature(payload, webhookSecret);
      const req = { body: payload, headers: { 'x-webhook-signature': signature } };
      const res = createMockRes();

      await controller.handleWebhook(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.type).toBe('non-text');
    });

    it('should handle sticker non-text message', async () => {
      const payload = { phone: '5511999887766', messageId: 'msg_sticker', sticker: { stickerUrl: 'https://example.com/sticker.webp' }, momment: '2024-01-15T10:30:00.000Z', type: 'ReceivedCallback', isGroup: false };
      const signature = createSignature(payload, webhookSecret);
      const req = { body: payload, headers: { 'x-webhook-signature': signature } };
      const res = createMockRes();

      await controller.handleWebhook(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.type).toBe('non-text');
    });

    it('should handle location non-text message', async () => {
      const payload = { phone: '5511999887766', messageId: 'msg_loc', location: { latitude: -23.5, longitude: -46.6 }, momment: '2024-01-15T10:30:00.000Z', type: 'ReceivedCallback', isGroup: false };
      const signature = createSignature(payload, webhookSecret);
      const req = { body: payload, headers: { 'x-webhook-signature': signature } };
      const res = createMockRes();

      await controller.handleWebhook(req, res);

      expect(res.statusCode).toBe(200);
      expect(res.body.type).toBe('non-text');
    });

    it('should strip leading + from phone number before processing', async () => {
      const payload = createValidPayload({ phone: '+5511999887766' });
      const signature = createSignature(payload, webhookSecret);
      const req = { body: payload, headers: { 'x-webhook-signature': signature } };
      const res = createMockRes();

      stateRepository.getControlMode.mockReturnValue('AI');

      await controller.handleWebhook(req, res);

      expect(stateRepository.getOrCreateConversation).toHaveBeenCalledWith('5511999887766');
    });
  });
});
