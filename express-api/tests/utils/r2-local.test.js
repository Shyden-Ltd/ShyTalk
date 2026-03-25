function setupR2Mock() {
  const mockSend = jest.fn().mockResolvedValue({});
  const MockS3Client = jest.fn().mockImplementation(() => ({ send: mockSend }));
  jest.doMock('@aws-sdk/client-s3', () => ({
    S3Client: MockS3Client,
    PutObjectCommand: jest.fn(),
    GetObjectCommand: jest.fn(),
    DeleteObjectCommand: jest.fn(),
    DeleteObjectsCommand: jest.fn(),
    ListObjectsV2Command: jest.fn(),
  }));
  return { MockS3Client, mockSend };
}

describe('r2.js local mode', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('creates S3Client with MinIO endpoint in local mode', () => {
    process.env.NODE_ENV = 'local';
    const { MockS3Client } = setupR2Mock();
    require('../../src/utils/r2');
    expect(MockS3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'http://localhost:9002',
        forcePathStyle: true,
      }),
    );
  });

  test('uses MINIO_ENDPOINT env var when set', () => {
    process.env.NODE_ENV = 'local';
    // eslint-disable-next-line sonarjs/no-clear-text-protocols
    process.env.MINIO_ENDPOINT = 'http://custom-host:9999';
    const { MockS3Client } = setupR2Mock();
    require('../../src/utils/r2');
    expect(MockS3Client).toHaveBeenCalledWith(
      // eslint-disable-next-line sonarjs/no-clear-text-protocols
      expect.objectContaining({ endpoint: 'http://custom-host:9999' }),
    );
  });

  test('CDN_URL defaults to MinIO in local mode', () => {
    process.env.NODE_ENV = 'local';
    setupR2Mock();
    const { CDN_URL } = require('../../src/utils/r2');
    expect(CDN_URL).toBe('http://localhost:9002/shytalk-media');
  });

  test('CDN_URL env var overrides local default', () => {
    process.env.NODE_ENV = 'local';
    // eslint-disable-next-line sonarjs/no-clear-text-protocols
    process.env.CDN_URL = 'http://custom-cdn:8080/media';
    setupR2Mock();
    const { CDN_URL } = require('../../src/utils/r2');
    // eslint-disable-next-line sonarjs/no-clear-text-protocols
    expect(CDN_URL).toBe('http://custom-cdn:8080/media');
  });

  test('creates S3Client with R2 endpoint in non-local mode', () => {
    process.env.NODE_ENV = 'production';
    process.env.R2_ACCOUNT_ID = 'test-account';
    process.env.R2_ACCESS_KEY_ID = 'test-key';
    process.env.R2_SECRET_ACCESS_KEY = 'test-secret';
    const { MockS3Client } = setupR2Mock();
    require('../../src/utils/r2');
    expect(MockS3Client).toHaveBeenCalledWith(
      expect.objectContaining({
        endpoint: 'https://test-account.r2.cloudflarestorage.com',
      }),
    );
  });
});
