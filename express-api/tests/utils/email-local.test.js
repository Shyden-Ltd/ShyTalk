jest.mock('nodemailer', () => ({
  createTransport: jest.fn().mockReturnValue({
    sendMail: jest.fn().mockResolvedValue({ messageId: 'test-id' }),
  }),
}));

describe('email.js local mode', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('uses Mailpit transport in local mode without SMTP credentials', async () => {
    process.env.NODE_ENV = 'local';
    const nodemailer = require('nodemailer');
    const { sendEmail } = require('../../src/utils/email');
    await sendEmail('test@example.com', 'Test Subject', '<p>Test</p>');
    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: 'localhost',
      port: 1025,
    });
  });

  test('uses custom SMTP_HOST/PORT in local mode when set', async () => {
    process.env.NODE_ENV = 'local';
    process.env.SMTP_HOST = 'custom-mail';
    process.env.SMTP_PORT = '2525';
    const nodemailer = require('nodemailer');
    const { sendEmail } = require('../../src/utils/email');
    await sendEmail('test@example.com', 'Test Subject', '<p>Test</p>');
    expect(nodemailer.createTransport).toHaveBeenCalledWith({
      host: 'custom-mail',
      port: 2525,
    });
  });

  test('throws when SMTP not configured in non-local mode', () => {
    process.env.NODE_ENV = 'production';
    const { sendEmail } = require('../../src/utils/email');
    expect(sendEmail('a@b.com', 's', 'h')).rejects.toThrow('SMTP not configured');
  });

  test('_resetTransport clears local mode transport', async () => {
    process.env.NODE_ENV = 'local';
    const nodemailer = require('nodemailer');
    const { sendEmail, _resetTransport } = require('../../src/utils/email');
    await sendEmail('a@b.com', 's', 'h');
    expect(nodemailer.createTransport).toHaveBeenCalledTimes(1);

    _resetTransport();
    await sendEmail('a@b.com', 's', 'h');
    expect(nodemailer.createTransport).toHaveBeenCalledTimes(2);
  });
});
