/**
 * Cloudflare Worker — ShyTalk Storage Proxy
 *
 * Endpoints:
 *   POST   /upload  — verify Firebase ID token, upload image bytes to R2, return public URL
 *   DELETE /delete  — verify token + ownership, delete object from R2
 *
 * Secrets (set via `wrangler secret put`):
 *   FIREBASE_API_KEY — Firebase Web API key
 *
 * Bindings (wrangler.toml):
 *   R2_BUCKET — R2 bucket binding for "shytalk-media"
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, DELETE, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
        },
      });
    }

    // Verify Firebase ID token
    const authHeader = request.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    const idToken = authHeader.slice(7);

    let uid;
    try {
      uid = await verifyFirebaseToken(idToken, env.FIREBASE_API_KEY);
    } catch {
      return Response.json({ error: "Invalid token" }, { status: 401 });
    }

    if (url.pathname === "/upload" && request.method === "POST") {
      return handleUpload(request, env, uid);
    } else if (url.pathname === "/delete" && request.method === "DELETE") {
      return handleDelete(url, env, uid);
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  },
};

async function verifyFirebaseToken(idToken, apiKey) {
  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    }
  );
  if (!response.ok) throw new Error("Token verification failed");
  const data = await response.json();
  if (!data.users?.length) throw new Error("User not found");
  return data.users[0].localId;
}

async function handleUpload(request, env, uid) {
  let formData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file");
  const path = formData.get("path");

  if (!file || !path) {
    return Response.json({ error: "Missing file or path" }, { status: 400 });
  }

  const contentType = file.type || "image/jpeg";
  const extension = getExtension(contentType);
  const key = `${path}/${uid}/${Date.now()}.${extension}`;

  const bytes = await file.arrayBuffer();
  await env.R2_BUCKET.put(key, bytes, {
    httpMetadata: { contentType },
  });

  return Response.json({ url: `https://images.shytalk.shyden.co.uk/${key}` });
}

async function handleDelete(url, env, uid) {
  const key = url.searchParams.get("key");
  if (!key) {
    return Response.json({ error: "Missing key" }, { status: 400 });
  }

  // Security: user can only delete their own files (path contains /{uid}/)
  if (!key.includes(`/${uid}/`)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  await env.R2_BUCKET.delete(key);
  return Response.json({ ok: true });
}

function getExtension(contentType) {
  if (contentType.startsWith("video/")) {
    const sub = contentType.slice(6);
    return sub === "quicktime" ? "mov" : sub;
  }
  const map = {
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
  };
  return map[contentType] ?? "jpg";
}
