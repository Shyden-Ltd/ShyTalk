/**
 * R2 storage client via S3-compatible API.
 *
 * Cloudflare R2 exposes an S3-compatible endpoint. We use the AWS SDK
 * to interact with it from outside Cloudflare Workers.
 *
 * Required env vars:
 *   R2_ACCOUNT_ID        — Cloudflare account ID
 *   R2_ACCESS_KEY_ID     — R2 API token access key
 *   R2_SECRET_ACCESS_KEY — R2 API token secret key
 *   R2_BUCKET_NAME       — Bucket name (default: shytalk-media)
 */

const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} = require('@aws-sdk/client-s3');

const accountId = process.env.R2_ACCOUNT_ID;
const bucketName = process.env.R2_BUCKET_NAME || 'shytalk-media';

const s3 = new S3Client({
  region: 'auto',
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const CDN_URL = process.env.CDN_URL || 'https://images.shytalk.shyden.co.uk';

async function putObject(key, body, contentType, metadata = {}) {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
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

module.exports = {
  s3,
  bucketName,
  putObject,
  getObject,
  deleteObject,
  deleteObjects,
  listObjects,
  listObjectsWithMetadata,
  CDN_URL,
};
