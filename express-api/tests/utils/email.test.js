let mockSendMail;

jest.mock('nodemailer', () => {
  mockSendMail = jest.fn().mockResolvedValue({ messageId: 'test-id-123' });
  return {
    createTransport: jest.fn(() => ({
      sendMail: mockSendMail,
    })),
  };
});

const nodemailer = require('nodemailer');
const { sendEmail, _resetTransport } = require('../../src/utils/email');

describe('Email Sender', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    _resetTransport();
    process.env = {
      ...originalEnv,
      SMTP_HOST: 'smtp.test.oraclecloud.com',
      SMTP_PORT: '587',
      SMTP_USER: 'testuser@example.com',
      SMTP_PASS: 'testsecretpass',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should send email with correct from address', async () => {
    await sendEmail('user@example.com', 'Test Subject', '<p>Hello</p>');

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: '"ShyTalk" <noreply@shytalk.shyden.co.uk>',
        to: 'user@example.com',
        subject: 'Test Subject',
        html: '<p>Hello</p>',
      }),
    );
  });

  it('should send email to the correct recipient', async () => {
    await sendEmail('different@test.com', 'Subject', '<p>Body</p>');

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'different@test.com' }),
    );
  });

  it('should pass the correct subject', async () => {
    await sendEmail('a@b.com', 'My Custom Subject', '<p>x</p>');

    expect(mockSendMail).toHaveBeenCalledWith(
      expect.objectContaining({ subject: 'My Custom Subject' }),
    );
  });

  it('should pass the html body', async () => {
    const html = '<div style="color:red">Important</div>';
    await sendEmail('a@b.com', 'Sub', html);

    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({ html }));
  });

  it('should create transport with correct SMTP config', async () => {
    await sendEmail('a@b.com', 's', 'h');

    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'smtp.test.oraclecloud.com',
        port: 587,
        secure: false,
        auth: {
          user: 'testuser@example.com',
          pass: 'testsecretpass',
        },
      }),
    );
  });

  it('should return the message ID on success', async () => {
    const result = await sendEmail('a@b.com', 's', 'h');
    expect(result).toEqual({ messageId: 'test-id-123' });
  });

  it('should throw if SMTP_HOST not configured', async () => {
    delete process.env.SMTP_HOST;
    await expect(sendEmail('a@b.com', 's', 'h')).rejects.toThrow('SMTP not configured');
  });

  it('should throw if SMTP_USER not configured', async () => {
    delete process.env.SMTP_USER;
    await expect(sendEmail('a@b.com', 's', 'h')).rejects.toThrow('SMTP not configured');
  });

  it('should throw if SMTP_PASS not configured', async () => {
    delete process.env.SMTP_PASS;
    await expect(sendEmail('a@b.com', 's', 'h')).rejects.toThrow('SMTP not configured');
  });

  it('should propagate transport errors', async () => {
    mockSendMail.mockRejectedValueOnce(new Error('Connection refused'));
    await expect(sendEmail('a@b.com', 's', 'h')).rejects.toThrow('Connection refused');
  });

  it('should reuse singleton transport across multiple sendEmail calls', async () => {
    await sendEmail('first@b.com', 'Subject 1', '<p>1</p>');
    await sendEmail('second@b.com', 'Subject 2', '<p>2</p>');

    // createTransport should only be called once (singleton)
    expect(nodemailer.createTransport).toHaveBeenCalledTimes(1);
    // But sendMail should be called twice
    expect(mockSendMail).toHaveBeenCalledTimes(2);
  });
});
