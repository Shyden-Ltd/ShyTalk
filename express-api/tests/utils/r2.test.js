/**
 * Tests for src/utils/r2.js — R2 storage client via S3-compatible API.
 *
 * Mocks the @aws-sdk/client-s3 module so no real S3/R2 calls are made.
 * Covers: putObject, getObject, deleteObject, deleteObjects, listObjects,
 *         listObjectsWithMetadata — success and error paths.
 */

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: jest.fn(() => ({ send: mockSend })),
    PutObjectCommand: jest.fn((params) => ({ _type: 'PutObjectCommand', ...params })),
    GetObjectCommand: jest.fn((params) => ({ _type: 'GetObjectCommand', ...params })),
    DeleteObjectCommand: jest.fn((params) => ({ _type: 'DeleteObjectCommand', ...params })),
    DeleteObjectsCommand: jest.fn((params) => ({ _type: 'DeleteObjectsCommand', ...params })),
    ListObjectsV2Command: jest.fn((params) => ({ _type: 'ListObjectsV2Command', ...params })),
  };
});

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} = require('@aws-sdk/client-s3');

const {
  putObject,
  getObject,
  deleteObject,
  deleteObjects,
  listObjects,
  listObjectsWithMetadata,
  bucketName,
  CDN_URL,
} = require('../../src/utils/r2');

// Capture the constructor call args before beforeEach clears them
const s3ClientInitArgs = S3Client.mock.calls[0]?.[0];

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── S3Client initialisation ──────────────────────────────────────

describe('S3Client initialisation', () => {
  it('creates an S3Client with region "auto"', () => {
    expect(s3ClientInitArgs).toBeDefined();
    expect(s3ClientInitArgs.region).toBe('auto');
  });

  it('uses R2 endpoint derived from R2_ACCOUNT_ID env var', () => {
    expect(s3ClientInitArgs.endpoint).toContain('.r2.cloudflarestorage.com');
  });
});

// ─── putObject ────────────────────────────────────────────────────

describe('putObject', () => {
  it('sends a PutObjectCommand with correct params', async () => {
    mockSend.mockResolvedValueOnce({});

    await putObject('avatars/abc.png', Buffer.from('img'), 'image/png');

    expect(PutObjectCommand).toHaveBeenCalledWith({
      Bucket: bucketName,
      Key: 'avatars/abc.png',
      Body: Buffer.from('img'),
      ContentType: 'image/png',
      CacheControl: 'public, max-age=31536000, immutable',
      Metadata: {},
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('passes custom metadata when provided', async () => {
    mockSend.mockResolvedValueOnce({});

    await putObject('key', Buffer.from('x'), 'image/jpeg', { userId: 'u1' });

    expect(PutObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({ Metadata: { userId: 'u1' } }),
    );
  });

  it('returns the CDN URL for the uploaded key', async () => {
    mockSend.mockResolvedValueOnce({});

    const url = await putObject('gifts/star.webp', Buffer.from('x'), 'image/webp');

    expect(url).toBe(`${CDN_URL}/gifts/star.webp`);
  });

  it('propagates S3 errors', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    await expect(putObject('k', Buffer.from('x'), 'image/png')).rejects.toThrow('AccessDenied');
  });
});

// ─── getObject ────────────────────────────────────────────────────

describe('getObject', () => {
  it('sends a GetObjectCommand with correct bucket and key', async () => {
    const fakeResp = { Body: 'stream', ContentType: 'image/png' };
    mockSend.mockResolvedValueOnce(fakeResp);

    const resp = await getObject('avatars/abc.png');

    expect(GetObjectCommand).toHaveBeenCalledWith({
      Bucket: bucketName,
      Key: 'avatars/abc.png',
    });
    expect(resp).toBe(fakeResp);
  });

  it('returns the full S3 response object', async () => {
    const fakeResp = { Body: 'data', ContentType: 'application/json', Metadata: { x: '1' } };
    mockSend.mockResolvedValueOnce(fakeResp);

    const resp = await getObject('some/key.json');

    expect(resp).toEqual(fakeResp);
  });

  it('propagates S3 errors', async () => {
    mockSend.mockRejectedValueOnce(new Error('NoSuchKey'));

    await expect(getObject('missing/key')).rejects.toThrow('NoSuchKey');
  });
});

// ─── deleteObject ─────────────────────────────────────────────────

describe('deleteObject', () => {
  it('sends a DeleteObjectCommand with correct bucket and key', async () => {
    mockSend.mockResolvedValueOnce({});

    await deleteObject('avatars/old.png');

    expect(DeleteObjectCommand).toHaveBeenCalledWith({
      Bucket: bucketName,
      Key: 'avatars/old.png',
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('returns undefined on success', async () => {
    mockSend.mockResolvedValueOnce({});

    const result = await deleteObject('some/key');

    expect(result).toBeUndefined();
  });

  it('propagates S3 errors', async () => {
    mockSend.mockRejectedValueOnce(new Error('InternalError'));

    await expect(deleteObject('key')).rejects.toThrow('InternalError');
  });
});

// ─── deleteObjects ────────────────────────────────────────────────

describe('deleteObjects', () => {
  it('does nothing when keys array is empty', async () => {
    await deleteObjects([]);

    expect(mockSend).not.toHaveBeenCalled();
    expect(DeleteObjectsCommand).not.toHaveBeenCalled();
  });

  it('sends a single batch for up to 1000 keys', async () => {
    mockSend.mockResolvedValueOnce({});
    const keys = ['a.png', 'b.png', 'c.png'];

    await deleteObjects(keys);

    expect(DeleteObjectsCommand).toHaveBeenCalledTimes(1);
    expect(DeleteObjectsCommand).toHaveBeenCalledWith({
      Bucket: bucketName,
      Delete: {
        Objects: [{ Key: 'a.png' }, { Key: 'b.png' }, { Key: 'c.png' }],
      },
    });
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('batches keys in groups of 1000', async () => {
    mockSend.mockResolvedValue({});

    // Generate 2500 keys: should result in 3 batches (1000, 1000, 500)
    const keys = Array.from({ length: 2500 }, (_, i) => `key-${i}`);

    await deleteObjects(keys);

    expect(DeleteObjectsCommand).toHaveBeenCalledTimes(3);
    expect(mockSend).toHaveBeenCalledTimes(3);

    // First batch: 1000 keys
    const firstBatchObjects = DeleteObjectsCommand.mock.calls[0][0].Delete.Objects;
    expect(firstBatchObjects).toHaveLength(1000);
    expect(firstBatchObjects[0]).toEqual({ Key: 'key-0' });
    expect(firstBatchObjects[999]).toEqual({ Key: 'key-999' });

    // Second batch: 1000 keys
    const secondBatchObjects = DeleteObjectsCommand.mock.calls[1][0].Delete.Objects;
    expect(secondBatchObjects).toHaveLength(1000);
    expect(secondBatchObjects[0]).toEqual({ Key: 'key-1000' });

    // Third batch: 500 keys
    const thirdBatchObjects = DeleteObjectsCommand.mock.calls[2][0].Delete.Objects;
    expect(thirdBatchObjects).toHaveLength(500);
    expect(thirdBatchObjects[499]).toEqual({ Key: 'key-2499' });
  });

  it('sends exactly 1 batch for exactly 1000 keys', async () => {
    mockSend.mockResolvedValueOnce({});
    const keys = Array.from({ length: 1000 }, (_, i) => `k-${i}`);

    await deleteObjects(keys);

    expect(DeleteObjectsCommand).toHaveBeenCalledTimes(1);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('propagates S3 errors', async () => {
    mockSend.mockRejectedValueOnce(new Error('BatchDeleteFailed'));

    await expect(deleteObjects(['a', 'b'])).rejects.toThrow('BatchDeleteFailed');
  });
});

// ─── listObjects ──────────────────────────────────────────────────

describe('listObjects', () => {
  it('sends a ListObjectsV2Command with prefix and default maxKeys', async () => {
    mockSend.mockResolvedValueOnce({ Contents: [{ Key: 'avatars/1.png' }], IsTruncated: false });

    const keys = await listObjects('avatars/');

    expect(ListObjectsV2Command).toHaveBeenCalledWith({
      Bucket: bucketName,
      Prefix: 'avatars/',
      MaxKeys: 1000,
      ContinuationToken: undefined,
    });
    expect(keys).toEqual(['avatars/1.png']);
  });

  it('uses custom maxKeys when provided', async () => {
    mockSend.mockResolvedValueOnce({ Contents: [], IsTruncated: false });

    await listObjects('prefix/', 500);

    expect(ListObjectsV2Command).toHaveBeenCalledWith(expect.objectContaining({ MaxKeys: 500 }));
  });

  it('returns empty array when Contents is empty', async () => {
    mockSend.mockResolvedValueOnce({ Contents: [], IsTruncated: false });

    const keys = await listObjects('empty/');

    expect(keys).toEqual([]);
  });

  it('returns empty array when Contents is undefined', async () => {
    mockSend.mockResolvedValueOnce({ IsTruncated: false });

    const keys = await listObjects('no-contents/');

    expect(keys).toEqual([]);
  });

  it('paginates through multiple pages using ContinuationToken', async () => {
    mockSend
      .mockResolvedValueOnce({
        Contents: [{ Key: 'a/1.png' }, { Key: 'a/2.png' }],
        IsTruncated: true,
        NextContinuationToken: 'token-page-2',
      })
      .mockResolvedValueOnce({
        Contents: [{ Key: 'a/3.png' }],
        IsTruncated: false,
      });

    const keys = await listObjects('a/');

    expect(keys).toEqual(['a/1.png', 'a/2.png', 'a/3.png']);
    expect(mockSend).toHaveBeenCalledTimes(2);

    // Second call should use the continuation token
    expect(ListObjectsV2Command).toHaveBeenCalledTimes(2);
    expect(ListObjectsV2Command.mock.calls[1][0]).toEqual(
      expect.objectContaining({ ContinuationToken: 'token-page-2' }),
    );
  });

  it('handles three pages of pagination', async () => {
    mockSend
      .mockResolvedValueOnce({
        Contents: [{ Key: 'x/1' }],
        IsTruncated: true,
        NextContinuationToken: 'tok-2',
      })
      .mockResolvedValueOnce({
        Contents: [{ Key: 'x/2' }],
        IsTruncated: true,
        NextContinuationToken: 'tok-3',
      })
      .mockResolvedValueOnce({
        Contents: [{ Key: 'x/3' }],
        IsTruncated: false,
      });

    const keys = await listObjects('x/');

    expect(keys).toEqual(['x/1', 'x/2', 'x/3']);
    expect(mockSend).toHaveBeenCalledTimes(3);
  });

  it('propagates S3 errors', async () => {
    mockSend.mockRejectedValueOnce(new Error('NetworkError'));

    await expect(listObjects('prefix/')).rejects.toThrow('NetworkError');
  });
});

// ─── listObjectsWithMetadata ──────────────────────────────────────

describe('listObjectsWithMetadata', () => {
  it('returns objects with key, size, and lastModified fields', async () => {
    const lastMod = new Date('2026-01-15T10:00:00Z');
    mockSend.mockResolvedValueOnce({
      Contents: [{ Key: 'img/a.png', Size: 1024, LastModified: lastMod }],
      IsTruncated: false,
    });

    const objects = await listObjectsWithMetadata('img/');

    expect(objects).toEqual([{ key: 'img/a.png', size: 1024, lastModified: lastMod }]);
  });

  it('sends ListObjectsV2Command with MaxKeys 1000', async () => {
    mockSend.mockResolvedValueOnce({ Contents: [], IsTruncated: false });

    await listObjectsWithMetadata('prefix/');

    expect(ListObjectsV2Command).toHaveBeenCalledWith({
      Bucket: bucketName,
      Prefix: 'prefix/',
      MaxKeys: 1000,
      ContinuationToken: undefined,
    });
  });

  it('returns empty array when Contents is undefined', async () => {
    mockSend.mockResolvedValueOnce({ IsTruncated: false });

    const objects = await listObjectsWithMetadata('empty/');

    expect(objects).toEqual([]);
  });

  it('paginates through multiple pages', async () => {
    const date1 = new Date('2026-01-01T00:00:00Z');
    const date2 = new Date('2026-02-01T00:00:00Z');

    mockSend
      .mockResolvedValueOnce({
        Contents: [{ Key: 'p/1.png', Size: 100, LastModified: date1 }],
        IsTruncated: true,
        NextContinuationToken: 'page-2-token',
      })
      .mockResolvedValueOnce({
        Contents: [{ Key: 'p/2.png', Size: 200, LastModified: date2 }],
        IsTruncated: false,
      });

    const objects = await listObjectsWithMetadata('p/');

    expect(objects).toEqual([
      { key: 'p/1.png', size: 100, lastModified: date1 },
      { key: 'p/2.png', size: 200, lastModified: date2 },
    ]);
    expect(mockSend).toHaveBeenCalledTimes(2);
    expect(ListObjectsV2Command.mock.calls[1][0]).toEqual(
      expect.objectContaining({ ContinuationToken: 'page-2-token' }),
    );
  });

  it('propagates S3 errors', async () => {
    mockSend.mockRejectedValueOnce(new Error('Forbidden'));

    await expect(listObjectsWithMetadata('prefix/')).rejects.toThrow('Forbidden');
  });
});

// ─── Exported constants ───────────────────────────────────────────

describe('exported constants', () => {
  it('exports a bucketName string', () => {
    expect(typeof bucketName).toBe('string');
    expect(bucketName.length).toBeGreaterThan(0);
  });

  it('exports a CDN_URL string', () => {
    expect(typeof CDN_URL).toBe('string');
    expect(CDN_URL).toMatch(/^https?:\/\//);
  });
});
