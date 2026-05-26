/**
 * R2 / MinIO storage client via S3-compatible API.
 *
 * In local mode (NODE_ENV=local), connects to MinIO.
 * In production/dev, connects to Cloudflare R2.
 * All endpoints configurable via env vars.
 */

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const isLocal = process.env.NODE_ENV === 'local';
const bucketName = process.env.R2_BUCKET_NAME || 'shytalk-media';

let s3;
if (isLocal) {
  const minioEndpoint = process.env.MINIO_ENDPOINT || 'http://localhost:9002';
  const minioUser = process.env.MINIO_ROOT_USER || 'minioadmin';
  const minioPass = process.env.MINIO_ROOT_PASSWORD || 'minioadmin';
  s3 = new S3Client({
    endpoint: minioEndpoint,
    region: 'us-east-1',
    credentials: { accessKeyId: minioUser, secretAccessKey: minioPass },
    forcePathStyle: true,
  });
} else {
  const accountId = process.env.R2_ACCOUNT_ID;
  s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

// Env-aware fallback. The previous shape was `isLocal ? local : prod`,
// which leaked the prod CDN URL on the dev environment (NODE_ENV !=
// local). The prod CDN host is publicly readable so this isn't a
// credential leak, but URLs returned by routes that consume
// `CDN_URL` (image responses, etc.) would silently point dev clients
// at prod-hosted media. Now: prod → prod CDN, local → MinIO,
// otherwise (dev / staging) → dev CDN. See feedback-environment-
// isolation memory.
// Single-line ternary kept (prettier-ignore) so the pre-commit URL-
// isolation guard sees the localhost fallback alongside the prod URL.

// prettier-ignore
const CDN_URL = process.env.CDN_URL || (isLocal ? `${process.env.MINIO_ENDPOINT || 'http://localhost:9002'}/${bucketName}` : process.env.NODE_ENV === 'production' ? 'https://images.shytalk.shyden.co.uk' : 'https://dev-images.shytalk.shyden.co.uk');

async function putObject(key, body, contentType, metadata = {}, options = {}) {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: options.cacheControl || 'public, max-age=31536000, immutable',
      Metadata: metadata,
    }),
  );
  return `${CDN_URL}/${key}`;
}

async function getObject(key) {
  const resp = await s3.send(new GetObjectCommand({ Bucket: bucketName, Key: key }));
  return resp;
}

async function deleteObject(key) {
  await s3.send(new DeleteObjectCommand({ Bucket: bucketName, Key: key }));
}

async function deleteObjects(keys) {
  if (keys.length === 0) return;
  // S3 DeleteObjects supports up to 1000 keys per call
  for (let i = 0; i < keys.length; i += 1000) {
    const batch = keys.slice(i, i + 1000);
    await s3.send(
      new DeleteObjectsCommand({
        Bucket: bucketName,
        Delete: { Objects: batch.map((k) => ({ Key: k })) },
      }),
    );
  }
}

async function listObjects(prefix, maxKeys = 1000) {
  const allKeys = [];
  let continuationToken;

  do {
    const resp = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: prefix,
        MaxKeys: maxKeys,
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of resp.Contents || []) {
      allKeys.push(obj.Key);
    }
    continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (continuationToken);

  return allKeys;
}

/**
 * List R2 objects under a prefix with full metadata (size, lastModified).
 * Used by admin backup/cleanup routes for audit and display.
 */
async function listObjectsWithMetadata(prefix) {
  const objects = [];
  let continuationToken;

  do {
    const resp = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucketName,
        Prefix: prefix,
        MaxKeys: 1000,
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of resp.Contents || []) {
      objects.push({ key: obj.Key, size: obj.Size, lastModified: obj.LastModified });
    }
    continuationToken = resp.IsTruncated ? resp.NextContinuationToken : undefined;
  } while (continuationToken);

  return objects;
}

/**
 * Issues a short-lived signed PUT URL the client can upload directly
 * to (no Express proxy). Used by age-verification submission flow:
 * the client gets a URL for `age-verification/<uid>/<random>.jpg`,
 * PUTs the ID image, then notifies the API of the R2 key.
 *
 * Defaults to 5-minute expiry to limit replay if the URL is
 * intercepted. Hard-caps overrides at 1 hour — anything longer is a
 * code smell and the helper refuses.
 */
/**
 * Pre-sign a GET to a private R2 object (admin-only viewing).
 *
 * Used for age-verification ID image preview in the admin panel: the
 * browser fetches the image directly from R2 with a short-lived URL
 * rather than streaming through Express. Cuts server load and lets
 * the browser cache normally.
 *
 * Default 5-minute expiry mirrors getSignedPutUrl. Hard-caps at 1h —
 * anything longer is a code smell for ID-image preview.
 */
async function getSignedGetUrl(key, expiresInSec = 300) {
  if (typeof key !== 'string' || key.length === 0) {
    throw new Error('r2.getSignedGetUrl: key must be a non-empty string');
  }
  if (typeof expiresInSec !== 'number' || expiresInSec <= 0 || expiresInSec > 3600) {
    throw new Error('r2.getSignedGetUrl: expiresInSec must be in (0, 3600]');
  }
  const command = new GetObjectCommand({ Bucket: bucketName, Key: key });
  return getSignedUrl(s3, command, { expiresIn: expiresInSec });
}

async function getSignedPutUrl(key, contentType, expiresInSec = 300) {
  if (typeof key !== 'string' || key.length === 0) {
    throw new Error('r2.getSignedPutUrl: key must be a non-empty string');
  }
  if (typeof contentType !== 'string' || contentType.length === 0) {
    throw new Error('r2.getSignedPutUrl: contentType must be a non-empty string');
  }
  if (typeof expiresInSec !== 'number' || expiresInSec <= 0 || expiresInSec > 3600) {
    throw new Error('r2.getSignedPutUrl: expiresInSec must be in (0, 3600]');
  }
  const command = new PutObjectCommand({
    Bucket: bucketName,
    Key: key,
    ContentType: contentType,
  });
  return getSignedUrl(s3, command, { expiresIn: expiresInSec });
}

module.exports = {
  s3,
  bucketName,
  putObject,
  getObject,
  deleteObject,
  deleteObjects,
  listObjects,
  listObjectsWithMetadata,
  getSignedPutUrl,
  getSignedGetUrl,
  CDN_URL,
};
