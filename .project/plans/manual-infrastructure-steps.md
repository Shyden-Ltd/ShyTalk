# Manual Infrastructure Setup — Step-by-Step Guide

Work through these 4 tasks in order. Each step has verification to confirm it worked.

---

## Task 1: Create Dev Firebase Project

### Step 1.1: Create the project

1. Go to https://console.firebase.google.com/
2. Click **"Add project"**
3. Project name: `shytalk-dev`
4. Disable Google Analytics (not needed for dev)
5. Click **"Create project"**

### Step 1.2: Set up Firestore

1. In the Firebase Console sidebar → **Build** → **Firestore Database**
2. Click **"Create database"**
3. Location: **`europe-west2` (London)**
4. Start in **production mode** (we'll deploy rules in a later step)

### Step 1.3: Set up Realtime Database

1. Sidebar → **Build** → **Realtime Database**
2. Click **"Create Database"**
3. Location: **`europe-west1` (Belgium)** — this is the closest available to London
4. Start in **locked mode**

### Step 1.4: Enable Authentication

1. Sidebar → **Build** → **Authentication**
2. Click **"Get started"**
3. Go to **Sign-in method** tab
4. Enable **Google** provider:
   - Use default project support email
   - Click **"Save"**
5. Enable **Email/Password** provider (for future use — not implemented yet)

### Step 1.5: Add Android apps to the project

You need TWO Android app entries — one for the base package (used by release builds) and one for the debug suffix (used by debug builds).

**First app (release builds):**
1. Go to **Project Settings** (gear icon → Project settings)
2. Click **"Add app"** → Android icon
3. Package name: `com.shyden.shytalk`
4. App nickname: `ShyTalk (release)`
5. Skip the SHA-1 for now — click **"Register app"**
6. Download `google-services.json` — **save it somewhere safe** (we'll use it later)
7. Click **"Continue"** through the remaining steps

**Second app (debug builds):**
1. Click **"Add app"** → Android icon again
2. Package name: `com.shyden.shytalk.dev`
3. App nickname: `ShyTalk DEV (debug)`
4. Click **"Register app"**
5. Download the **updated** `google-services.json` — this one now includes BOTH package names
6. **This is the file you need** — save it as `app/src/dev/google-services.json` in the project

> **Important:** The second download replaces the first. You only need the last downloaded file since it contains both app entries.

### Step 1.6: Enable Cloud Messaging

1. Sidebar → **Build** → **Cloud Messaging**
2. It should already be enabled by default
3. Verify you see the Cloud Messaging dashboard

### Step 1.7: Generate service account key

1. **Project Settings** → **Service accounts** tab
2. Click **"Generate new private key"**
3. Save the file as `shytalk-dev-firebase-adminsdk.json`
4. **Do NOT commit this file to git** — it will be uploaded to the London server

### Step 1.8: Deploy security rules to dev project

Open a terminal in the ShyTalk project root:

```bash
# Add the dev project to your Firebase CLI
npx firebase projects:list
# You should see both shytalk-7ba69 and shytalk-dev

# Switch to dev project
npx firebase use shytalk-dev

# Deploy Firestore rules
npx firebase deploy --only firestore:rules

# Deploy RTDB rules
npx firebase deploy --only database

# Switch back to prod (so you don't accidentally modify dev by default)
npx firebase use shytalk-7ba69
```

### Step 1.9: Move production google-services.json

The current `app/google-services.json` is for production. Move it:

```bash
# In the worktree directory (.worktrees/dev-environment/)
cp app/google-services.json app/src/prod/google-services.json
```

> Note: Don't `git rm` the root one yet — the build flavor config will handle the lookup path.

### Verification

- [ ] Firebase Console shows `shytalk-dev` project
- [ ] Firestore Database exists in `europe-west2`
- [ ] Realtime Database exists in `europe-west1`
- [ ] Authentication has Google + Email/Password enabled
- [ ] Two Android apps registered (`.shytalk` and `.shytalk.dev`)
- [ ] `google-services.json` downloaded and saved to `app/src/dev/google-services.json`
- [ ] Service account key saved (NOT in git)
- [ ] Firestore rules deployed successfully
- [ ] RTDB rules deployed successfully
- [ ] Production `google-services.json` copied to `app/src/prod/`

---

## Task 2: Create Dev R2 Bucket and CDN

### Step 2.1: Create the bucket

1. Go to https://dash.cloudflare.com/
2. Sidebar → **R2 Object Storage** → **Overview**
3. Click **"Create bucket"**
4. Bucket name: `shytalk-media-dev`
5. Location hint: **Western Europe (WEUR)**
6. Click **"Create bucket"**

### Step 2.2: Create R2 API token for dev

1. In R2 → **Manage R2 API Tokens** (link at top of R2 overview page)
2. Click **"Create API Token"**
3. Token name: `shytalk-dev-api`
4. Permissions: **Object Read & Write**
5. Specify bucket: **`shytalk-media-dev`** only
6. TTL: No expiration (or set to 1 year)
7. Click **"Create API Token"**
8. **Copy and save** the Access Key ID and Secret Access Key — you'll need these for the London server `.env`

### Step 2.3: Set up dev CDN domain

1. In R2 → click on `shytalk-media-dev` bucket
2. Go to **Settings** tab
3. Under **Custom Domains**, click **"Connect Domain"**
4. Enter: `dev-images.shytalk.shyden.co.uk`
5. Click **"Continue"** → Cloudflare will auto-create the DNS record
6. Wait for the status to show **"Active"**

### Verification

```bash
# Should return a Cloudflare response (403 or similar — bucket is empty but domain works)
curl -I https://dev-images.shytalk.shyden.co.uk/
```

- [ ] R2 bucket `shytalk-media-dev` created in WEUR
- [ ] API token created with Access Key ID and Secret Access Key saved
- [ ] Custom domain `dev-images.shytalk.shyden.co.uk` connected and active
- [ ] `curl -I` returns a response (not DNS error)

---

## Task 3: Configure London Server as Dev API

### Step 3.1: Add DNS record

1. Cloudflare Dashboard → **DNS** for `shyden.co.uk`
2. Click **"Add record"**
3. Type: **A**
4. Name: `dev-api.shytalk`
5. IPv4 address: `145.241.224.13`
6. Proxy status: **Proxied** (orange cloud ON)
7. Click **"Save"**

### Step 3.2: SSH to London and update Caddy

```bash
ssh -i ~/.ssh/shytalk-oci ubuntu@145.241.224.13
```

Edit the Caddyfile:
```bash
sudo nano /etc/caddy/Caddyfile
```

**Replace the existing content** (or add alongside existing entries) so it includes:

```
dev-api.shytalk.shyden.co.uk {
    reverse_proxy localhost:3000
}
```

> Note: If there's an existing `api.shytalk.shyden.co.uk` block pointing to the old prod API, you can remove it since prod is now on Singapore. Keep only the dev-api entry.

Save and restart Caddy:
```bash
sudo systemctl restart caddy
sudo systemctl status caddy  # Verify it's running
```

### Step 3.3: Upload dev service account

From your **local machine** (not SSH):

```bash
scp -i ~/.ssh/shytalk-oci shytalk-dev-firebase-adminsdk.json ubuntu@145.241.224.13:~/express-api/
```

### Step 3.4: Create dev `.env` on London

SSH back into the server:
```bash
ssh -i ~/.ssh/shytalk-oci ubuntu@145.241.224.13
```

Create the environment file:
```bash
nano ~/express-api/.env
```

Paste this content, **replacing the placeholders with actual values**:

```env
NODE_ENV=development
PORT=3000

# Dev Firebase
FIREBASE_SERVICE_ACCOUNT_PATH=/home/ubuntu/express-api/shytalk-dev-firebase-adminsdk.json
FIREBASE_PROJECT_ID=shytalk-dev
FIREBASE_DATABASE_URL=https://shytalk-dev-default-rtdb.europe-west1.firebasedatabase.app

# Dev R2 (from Task 2, Step 2.2)
R2_ACCOUNT_ID=9315582c39b627dca58dfa83602db385
R2_ACCESS_KEY_ID=<paste-dev-r2-access-key-from-task-2>
R2_SECRET_ACCESS_KEY=<paste-dev-r2-secret-key-from-task-2>
R2_BUCKET_NAME=shytalk-media-dev
CDN_URL=https://dev-images.shytalk.shyden.co.uk

# LiveKit (same keys as prod — shared LiveKit project)
LIVEKIT_API_KEY=<copy-from-singapore-server>
LIVEKIT_API_SECRET=<copy-from-singapore-server>

# Test API key (generate a random string — used by E2E tests)
TEST_API_KEY=<generate-with: openssl rand -hex 32>
```

> To get LiveKit keys from Singapore: `ssh -i ~/.ssh/shytalk-oci ubuntu@213.35.98.160 "grep LIVEKIT ~/shytalk-api/.env"`

> To generate TEST_API_KEY: `openssl rand -hex 32` (run locally, paste the result)

### Step 3.5: Deploy Express API to London

From your **local machine**, in the project root:

```bash
cd express-api
tar czf /tmp/shytalk-api.tar.gz --exclude='node_modules' --exclude='.env' .
scp -i ~/.ssh/shytalk-oci /tmp/shytalk-api.tar.gz ubuntu@145.241.224.13:/tmp/
ssh -i ~/.ssh/shytalk-oci ubuntu@145.241.224.13 "cd ~/express-api && tar xzf /tmp/shytalk-api.tar.gz && npm install --production && pm2 restart shytalk-api"
```

### Step 3.6: Verify

```bash
curl https://dev-api.shytalk.shyden.co.uk/api/health
```

Expected response:
```json
{"status":"ok","timestamp":1741...}
```

### Verification

- [ ] DNS record `dev-api.shytalk` → `145.241.224.13` added in Cloudflare
- [ ] Caddy configured for `dev-api.shytalk.shyden.co.uk` and restarted
- [ ] Service account uploaded to `~/express-api/` on London
- [ ] `.env` created with all values filled in (no `<placeholders>` remaining)
- [ ] Express API deployed and PM2 restarted
- [ ] `curl` health check returns `{"status":"ok",...}`

---

## Task 4: Set Up Dev Cloudflare Pages

> Note: The code changes (config.js files, index.html update) have already been done. This task is about creating the Cloudflare Pages project.

### Step 4.1: Deploy dev site

From the **worktree directory** (`.worktrees/dev-environment/`):

```bash
# Copy dev config as the active config for this deployment
cp public/admin/config.dev.js public/admin/config.js

# Deploy to Cloudflare Pages
npx wrangler pages deploy public --project-name shytalk-site-dev

# Restore the prod config
git checkout public/admin/config.js
```

> First time deploying to `shytalk-site-dev` will create the project automatically.

### Step 4.2: Add custom domain

1. Cloudflare Dashboard → **Workers & Pages** → `shytalk-site-dev`
2. Go to **Custom domains** tab
3. Click **"Set up a custom domain"**
4. Enter: `dev.shytalk.shyden.co.uk`
5. Click **"Continue"** → Cloudflare auto-creates the DNS record
6. Wait for status to show **"Active"**

### Step 4.3: Update dev config with real Firebase key

Once you have the dev Firebase API key (from Task 1), update `public/admin/config.dev.js`:
- Replace `<dev-firebase-api-key>` with the actual API key from Firebase Console → Project Settings → General → Web API Key

### Verification

```bash
# Should load the dev config
curl -s https://dev.shytalk.shyden.co.uk/admin/config.js | head -5
```

Should show the dev API base URL and Firebase config.

- [ ] `shytalk-site-dev` Cloudflare Pages project created
- [ ] Custom domain `dev.shytalk.shyden.co.uk` connected and active
- [ ] `config.dev.js` updated with real Firebase API key
- [ ] Site loads at `https://dev.shytalk.shyden.co.uk/admin/`

---

## Quick Reference: Values You'll Generate

| Value | Where generated | Where used |
|-------|----------------|-----------|
| Dev Firebase API Key | Task 1 → Project Settings | `config.dev.js`, dev `google-services.json` |
| Dev `google-services.json` | Task 1 → Add Android app | `app/src/dev/google-services.json` |
| Service account JSON | Task 1 → Service accounts | London server `~/express-api/` |
| R2 Access Key ID | Task 2 → Create API Token | London server `.env` |
| R2 Secret Access Key | Task 2 → Create API Token | London server `.env` |
| LiveKit API Key | From Singapore server | London server `.env` |
| LiveKit API Secret | From Singapore server | London server `.env` |
| TEST_API_KEY | `openssl rand -hex 32` | London server `.env` |
