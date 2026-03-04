/**
 * Firestore REST API utility.
 *
 * Uses the shared OAuth2 token from fcm.js (which now includes the
 * datastore scope) to read/write Firestore via its REST API.
 *
 * Base URL pattern:
 *   https://firestore.googleapis.com/v1/projects/{projectId}/databases/(default)/documents
 */

const { getAccessToken } = require('./fcm');

// ─── Value converters ────────────────────────────────────────────

/**
 * Convert a plain JS value to Firestore REST API typed-value format.
 */
function toFirestoreValue(val) {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    return Number.isInteger(val)
      ? { integerValue: String(val) }
      : { doubleValue: val };
  }
  if (typeof val === 'string') return { stringValue: val };
  if (val instanceof Date) return { timestampValue: val.toISOString() };
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(toFirestoreValue) } };
  }
  if (typeof val === 'object') {
    return { mapValue: { fields: toFirestoreFields(val) } };
  }
  return { stringValue: String(val) };
}

/**
 * Convert a plain JS object to Firestore fields map.
 */
function toFirestoreFields(obj) {
  const fields = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    fields[k] = toFirestoreValue(v);
  }
  return fields;
}

/**
 * Convert a Firestore typed-value back to a plain JS value.
 */
function fromFirestoreValue(val) {
  if (!val) return null;
  if ('nullValue' in val) return null;
  if ('booleanValue' in val) return val.booleanValue;
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return val.doubleValue;
  if ('stringValue' in val) return val.stringValue;
  if ('timestampValue' in val) return val.timestampValue;
  if ('arrayValue' in val) {
    return (val.arrayValue.values || []).map(fromFirestoreValue);
  }
  if ('mapValue' in val) {
    return fromFirestoreFields(val.mapValue.fields || {});
  }
  if ('geoPointValue' in val) return val.geoPointValue;
  if ('referenceValue' in val) return val.referenceValue;
  if ('bytesValue' in val) return val.bytesValue;
  return null;
}

/**
 * Convert Firestore fields map back to a plain JS object.
 */
function fromFirestoreFields(fields) {
  const obj = {};
  for (const [k, v] of Object.entries(fields)) {
    obj[k] = fromFirestoreValue(v);
  }
  return obj;
}

/**
 * Convert a full Firestore document response to { id, ...data }.
 */
function fromFirestoreDoc(doc) {
  if (!doc || !doc.name) return null;
  // name: "projects/{p}/databases/(default)/documents/{collection}/{id}"
  const parts = doc.name.split('/');
  const id = parts[parts.length - 1];
  const data = fromFirestoreFields(doc.fields || {});
  return { id, ...data };
}

// ─── Circuit breaker for Cloudflare daily quota ─────────────────
// When Cloudflare returns 429 (daily request limit reached), stop all
// Firestore calls until midnight UTC to preserve remaining quota.
// Uses KV to persist the tripped state across Worker invocations.

const CIRCUIT_BREAKER_KEY = 'firestore_circuit_open';
let circuitOpenCached = false; // In-memory cache to avoid KV reads on every call

async function isCircuitOpen(env) {
  if (circuitOpenCached) return true;
  if (!env.KV) return false;
  const val = await env.KV.get(CIRCUIT_BREAKER_KEY);
  if (val) { circuitOpenCached = true; return true; }
  return false;
}

async function tripCircuitBreaker(env) {
  circuitOpenCached = true;
  if (!env.KV) return;
  // Calculate seconds until midnight UTC
  const now = new Date();
  const midnight = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const ttl = Math.max(Math.ceil((midnight - now) / 1000), 60);
  await env.KV.put(CIRCUIT_BREAKER_KEY, '1', { expirationTtl: ttl });
  console.log(`Circuit breaker tripped — Firestore calls disabled for ${ttl}s (until midnight UTC)`);
}

/**
 * Fetch wrapper that respects the circuit breaker.
 * On 429: trips the breaker and returns the 429 response (no retry).
 */
async function firestoreFetch(url, options, env) {
  if (env && await isCircuitOpen(env)) {
    return { ok: false, status: 429, text: async () => 'Circuit breaker open — Cloudflare daily limit reached' };
  }
  const response = await fetch(url, options);
  if (response.status === 429 && env) {
    await tripCircuitBreaker(env);
  }
  return response;
}

// ─── REST API helpers ────────────────────────────────────────────

function baseUrl(env) {
  const projectId = env.FIREBASE_PROJECT_ID;
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
}

/**
 * GET a single document.
 * @param {object} env
 * @param {string} path - e.g. "users/abc123" or "rooms/r1/messages/m1"
 * @returns {object|null} plain JS object with { id, ...fields } or null if not found
 */
async function getDoc(env, path) {
  if (!env.FIREBASE_PROJECT_ID) {
    console.error('FIREBASE_PROJECT_ID not configured — skipping Firestore read');
    return null;
  }

  const accessToken = await getAccessToken(env);
  const url = `${baseUrl(env)}/${path}`;

  const response = await firestoreFetch(url, {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  }, env);

  if (response.status === 404) return null;
  if (!response.ok) {
    const text = await response.text();
    console.error(`Firestore GET ${path}: ${response.status} ${text}`);
    return null;
  }

  return fromFirestoreDoc(await response.json());
}

/**
 * Create or overwrite a document (PUT).
 * @param {object} env
 * @param {string} path - e.g. "users/abc123"
 * @param {object} data - plain JS object
 */
async function setDoc(env, path, data) {
  if (!env.FIREBASE_PROJECT_ID) {
    console.error('FIREBASE_PROJECT_ID not configured — skipping Firestore write');
    return;
  }

  const accessToken = await getAccessToken(env);
  const url = `${baseUrl(env)}/${path}`;

  const response = await firestoreFetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields: toFirestoreFields(data) }),
  }, env);

  if (!response.ok) {
    const text = await response.text();
    console.error(`Firestore SET ${path}: ${response.status} ${text}`);
  }
}

/**
 * Update specific fields on a document (PATCH with updateMask).
 * @param {object} env
 * @param {string} path
 * @param {object} fields - plain JS object of fields to update
 */
async function updateDoc(env, path, fields) {
  if (!env.FIREBASE_PROJECT_ID) {
    console.error('FIREBASE_PROJECT_ID not configured — skipping Firestore update');
    return;
  }

  const accessToken = await getAccessToken(env);
  const fieldPaths = Object.keys(fields);
  const mask = fieldPaths.map(f => `updateMask.fieldPaths=${encodeURIComponent(f)}`).join('&');
  const url = `${baseUrl(env)}/${path}?${mask}`;

  const response = await firestoreFetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields: toFirestoreFields(fields) }),
  }, env);

  if (!response.ok) {
    const text = await response.text();
    console.error(`Firestore UPDATE ${path}: ${response.status} ${text}`);
  }
}

/**
 * Delete a document.
 * @param {object} env
 * @param {string} path
 */
async function deleteDoc(env, path) {
  if (!env.FIREBASE_PROJECT_ID) {
    console.error('FIREBASE_PROJECT_ID not configured — skipping Firestore delete');
    return;
  }

  const accessToken = await getAccessToken(env);
  const url = `${baseUrl(env)}/${path}`;

  const response = await firestoreFetch(url, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${accessToken}` },
  }, env);

  if (!response.ok) {
    const text = await response.text();
    console.error(`Firestore DELETE ${path}: ${response.status} ${text}`);
  }
}

/**
 * Run a structured query against a collection.
 * @param {object} env
 * @param {string} collectionPath - e.g. "rooms" or "rooms/r1/messages"
 * @param {object} structuredQuery - Firestore StructuredQuery object
 * @returns {Array} array of { id, ...fields } objects
 */
async function queryCollection(env, collectionPath, structuredQuery) {
  if (!env.FIREBASE_PROJECT_ID) {
    console.error('FIREBASE_PROJECT_ID not configured — skipping Firestore query');
    return [];
  }

  const accessToken = await getAccessToken(env);

  // For subcollections like "rooms/r1/messages", parent is "rooms/r1"
  // and collectionId is "messages"
  const parts = collectionPath.split('/');
  const collectionId = parts.pop();
  const parentPath = parts.length > 0 ? `/${parts.join('/')}` : '';
  const url = `${baseUrl(env)}${parentPath}:runQuery`;

  const query = {
    structuredQuery: {
      from: [{ collectionId }],
      ...structuredQuery,
    },
  };

  const response = await firestoreFetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(query),
  }, env);

  if (!response.ok) {
    const text = await response.text();
    console.error(`Firestore QUERY ${collectionPath}: ${response.status} ${text}`);
    return [];
  }

  const results = await response.json();
  return results
    .filter(r => r.document)
    .map(r => fromFirestoreDoc(r.document));
}

/**
 * Batch write up to 500 operations.
 * @param {object} env
 * @param {Array} writes - array of Firestore Write objects:
 *   { update: { name, fields } } for upsert
 *   { delete: documentPath } for delete
 */
async function batchWrite(env, writes) {
  if (!env.FIREBASE_PROJECT_ID) {
    console.error('FIREBASE_PROJECT_ID not configured — skipping Firestore batch');
    return;
  }

  if (writes.length === 0) return;
  if (writes.length > 500) {
    throw new Error(`Firestore batchWrite: max 500 ops, got ${writes.length}`);
  }

  const accessToken = await getAccessToken(env);
  const projectId = env.FIREBASE_PROJECT_ID;
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:batchWrite`;

  const response = await firestoreFetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ writes }),
  }, env);

  if (!response.ok) {
    const text = await response.text();
    console.error(`Firestore BATCH: ${response.status} ${text}`);
  }
}

// ─── Convenience: build a batch update op ────────────────────────

/**
 * Helper to create a batch update write operation.
 * @param {object} env
 * @param {string} path - document path e.g. "users/abc123"
 * @param {object} data - plain JS object
 */
function batchUpdateOp(env, path, data) {
  const projectId = env.FIREBASE_PROJECT_ID;
  return {
    update: {
      name: `projects/${projectId}/databases/(default)/documents/${path}`,
      fields: toFirestoreFields(data),
    },
  };
}

/**
 * Helper to create a batch delete write operation.
 * @param {object} env
 * @param {string} path - document path
 */
function batchDeleteOp(env, path) {
  const projectId = env.FIREBASE_PROJECT_ID;
  return {
    delete: `projects/${projectId}/databases/(default)/documents/${path}`,
  };
}

// ─── Query builder helpers ───────────────────────────────────────

/**
 * Build a Firestore field filter for structured queries.
 * @param {string} fieldPath - e.g. "isActive"
 * @param {string} op - EQUAL, NOT_EQUAL, LESS_THAN, LESS_THAN_OR_EQUAL,
 *                       GREATER_THAN, GREATER_THAN_OR_EQUAL, ARRAY_CONTAINS,
 *                       ARRAY_CONTAINS_ANY, IN, NOT_IN
 * @param {*} value - plain JS value
 */
function fieldFilter(fieldPath, op, value) {
  return {
    fieldFilter: {
      field: { fieldPath },
      op,
      value: toFirestoreValue(value),
    },
  };
}

/**
 * Build a composite AND filter from multiple filters.
 */
function andFilter(...filters) {
  if (filters.length === 1) return filters[0];
  return {
    compositeFilter: {
      op: 'AND',
      filters,
    },
  };
}

/**
 * Build an orderBy clause.
 * @param {string} fieldPath
 * @param {'ASCENDING'|'DESCENDING'} direction
 */
function orderBy(fieldPath, direction = 'ASCENDING') {
  return { field: { fieldPath }, direction };
}

// ─── Atomic field increment ─────────────────────────────────────

/**
 * Atomically increment a numeric field on a document.
 * Returns the new value of the field after increment.
 * @param {object} env
 * @param {string} path - document path e.g. "counters/uniqueId"
 * @param {string} field - field name to increment
 * @param {number} amount - increment amount (can be negative)
 * @returns {number|null} the new value, or null on error
 */
async function incrementField(env, path, field, amount = 1) {
  if (!env.FIREBASE_PROJECT_ID) return null;

  const accessToken = await getAccessToken(env);
  const projectId = env.FIREBASE_PROJECT_ID;
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:commit`;

  const response = await firestoreFetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      writes: [{
        transform: {
          document: `projects/${projectId}/databases/(default)/documents/${path}`,
          fieldTransforms: [{
            fieldPath: field,
            increment: Number.isInteger(amount)
              ? { integerValue: String(amount) }
              : { doubleValue: amount },
          }],
        },
      }],
    }),
  }, env);

  if (!response.ok) {
    const text = await response.text();
    console.error(`Firestore INCREMENT ${path}.${field}: ${response.status} ${text}`);
    return null;
  }

  const result = await response.json();
  // Extract the new value from transformResults
  const transformResult = result?.writeResults?.[0]?.transformResults?.[0];
  if (transformResult) {
    return fromFirestoreValue(transformResult);
  }

  // Fall back to reading the document
  const doc = await getDoc(env, path);
  return doc?.[field] ?? null;
}

// ─── Firestore transactions ─────────────────────────────────────

/**
 * Run a Firestore transaction: reads are consistent, writes are atomic.
 * @param {object} env
 * @param {string[]} readPaths - document paths to read within transaction
 * @param {function} writeFn - receives { path: docData } map, returns array of
 *   Firestore Write objects (same format as batchWrite)
 * @returns {object} map of { path: docData } from reads
 */
async function runTransaction(env, readPaths, writeFn) {
  if (!env.FIREBASE_PROJECT_ID) throw new Error('FIREBASE_PROJECT_ID not set');

  const accessToken = await getAccessToken(env);
  const projectId = env.FIREBASE_PROJECT_ID;
  const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

  // 1. Begin transaction
  const beginRes = await fetch(`${base}:beginTransaction`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!beginRes.ok) {
    const text = await beginRes.text();
    throw new Error(`beginTransaction failed: ${beginRes.status} ${text}`);
  }
  const { transaction } = await beginRes.json();

  // 2. Read documents within transaction
  const docs = {};
  for (const path of readPaths) {
    const readRes = await fetch(`${base}/${path}?transaction=${encodeURIComponent(transaction)}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });
    if (readRes.status === 404) {
      docs[path] = null;
    } else if (readRes.ok) {
      docs[path] = fromFirestoreDoc(await readRes.json());
    } else {
      docs[path] = null;
    }
  }

  // 3. Compute writes from user function
  const writes = writeFn(docs);

  // 4. Commit
  const commitRes = await fetch(`${base}:commit`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ transaction, writes }),
  });

  if (!commitRes.ok) {
    const text = await commitRes.text();
    throw new Error(`Transaction commit failed: ${commitRes.status} ${text}`);
  }

  return docs;
}

// ─── Convenience: build a batch transform op ─────────────────────

/**
 * Helper to create a batch increment transform write operation.
 * @param {object} env
 * @param {string} path - document path
 * @param {object} increments - { fieldName: amount, ... }
 */
function batchIncrementOp(env, path, increments) {
  const projectId = env.FIREBASE_PROJECT_ID;
  return {
    transform: {
      document: `projects/${projectId}/databases/(default)/documents/${path}`,
      fieldTransforms: Object.entries(increments).map(([fieldPath, amount]) => ({
        fieldPath,
        increment: Number.isInteger(amount)
          ? { integerValue: String(amount) }
          : { doubleValue: amount },
      })),
    },
  };
}

module.exports = {
  isCircuitOpen,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  queryCollection,
  batchWrite,
  batchUpdateOp,
  batchDeleteOp,
  batchIncrementOp,
  incrementField,
  runTransaction,
  fieldFilter,
  andFilter,
  orderBy,
  toFirestoreValue,
  toFirestoreFields,
  fromFirestoreValue,
  fromFirestoreFields,
  fromFirestoreDoc,
};
