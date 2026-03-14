# Express API Migration to Singapore — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Move the Express API from Oracle Cloud London to Oracle Cloud Singapore (ARM) to co-locate with Firebase asia-southeast1 and reduce latency.

**Architecture:** Lift-and-shift — same Express.js + PM2 + Caddy stack on a new ARM VM. DNS switch via Cloudflare for zero-downtime cutover. No code changes required.

**Tech Stack:** Oracle Cloud ARM (A1.Flex), Ubuntu 22.04 aarch64, Node.js 20 LTS, PM2, Caddy, Cloudflare DNS

---

### Task 1: Provision Oracle Cloud ARM VM in Singapore

**Context:** This task is done entirely in the Oracle Cloud Console (browser). No local files to modify.

**Step 1: Create the VM**
- Log in to Oracle Cloud Console at https://cloud.oracle.com
- Navigate: Compute → Instances → Create Instance
- Configure:
  - **Name:** `shytalk-api-singapore`
  - **Region:** ap-singapore-1
  - **Availability Domain:** Any available (AD-1 preferred)
  - **Shape:** VM.Standard.A1.Flex (Ampere ARM)
  - **OCPUs:** 4
  - **Memory:** 24 GB
  - **Image:** Canonical Ubuntu 22.04 aarch64
  - **Boot volume:** 47 GB (default, free)
  - **Networking:** Create new VCN + public subnet, assign public IPv4
  - **SSH key:** Paste contents of `~/.ssh/shytalk-oci.pub` (or generate new pair)

**Step 2: Configure security list**
- Navigate: Networking → Virtual Cloud Networks → select VCN → Security Lists → Default
- Add 2 ingress rules:
  - Source: `0.0.0.0/0`, Protocol: TCP, Destination Port: **80**
  - Source: `0.0.0.0/0`, Protocol: TCP, Destination Port: **443**
- Port 22 (SSH) should already be open by default

**Step 3: Note the public IP**
- Go back to Instances → click `shytalk-api-singapore` → copy the **Public IP address**
- You'll need this for all subsequent steps

**Step 4: Verify SSH access**

```bash
ssh -i ~/.ssh/shytalk-oci ubuntu@<SINGAPORE_IP>
# Expected: Ubuntu welcome banner, shell prompt
exit
```

**Step 5: Commit** (no code changes — just document the new IP)

Update `MEMORY.md` with the Singapore VM details:
```
- **Singapore VM IP:** <SINGAPORE_IP> (Oracle Cloud ap-singapore-1)
- **SSH:** `ssh -i ~/.ssh/shytalk-oci ubuntu@<SINGAPORE_IP>`
```

```bash
git add -A && git commit -m "docs: record Singapore VM IP in memory"
```

---

### Task 2: Bootstrap the Singapore Server

**Step 1: SSH into the Singapore VM**

```bash
ssh -i ~/.ssh/shytalk-oci ubuntu@<SINGAPORE_IP>
```

**Step 2: System updates**

```bash
sudo apt update && sudo apt upgrade -y
```

**Step 3: Install Node.js 20 LTS (ARM64)**

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node --version  # Expected: v20.x.x
npm --version   # Expected: 10.x.x
```

**Step 4: Install PM2**

```bash
sudo npm install -g pm2
pm2 --version  # Expected: 5.x.x
```

**Step 5: Install Caddy**

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
caddy version  # Expected: v2.x.x
```

**Step 6: Configure Caddy**

```bash
sudo tee /etc/caddy/Caddyfile <<'EOF'
api.shytalk.shyden.co.uk {
    reverse_proxy localhost:3000
}
EOF
# Don't restart Caddy yet — DNS doesn't point here yet.
# Caddy will auto-provision the TLS cert once DNS is switched.
sudo systemctl stop caddy
```

**Step 7: Set up swap (safety net)**

```bash
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
free -h  # Confirm swap shows 2.0G
```

**Step 8: Configure OS firewall (iptables)**

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

**Step 9: Verify**

```bash
node --version && pm2 --version && caddy version
# All three should print version numbers
free -h | grep Swap
# Should show 2.0G
sudo iptables -L INPUT -n | grep -E '80|443'
# Should show ACCEPT rules for ports 80 and 443
```

---

### Task 3: Deploy Express API to Singapore

**Step 1: Package the API locally**

```bash
cd /c/Users/saste/AndroidStudioProjects/ShyTalk/express-api
tar czf /tmp/shytalk-api.tar.gz --exclude=node_modules --exclude=.env --exclude=logs .
```

**Step 2: Upload to Singapore VM**

```bash
scp -i ~/.ssh/shytalk-oci /tmp/shytalk-api.tar.gz ubuntu@<SINGAPORE_IP>:~/
```

**Step 3: Extract and install dependencies**

```bash
ssh -i ~/.ssh/shytalk-oci ubuntu@<SINGAPORE_IP>
mkdir -p ~/shytalk-api/logs && cd ~/shytalk-api
tar xzf ~/shytalk-api.tar.gz
npm install --production
```

**Step 4: Copy environment files from London**

Copy the `.env` file from the London VM:
```bash
# From local machine — pull .env from London, push to Singapore
scp -i ~/.ssh/shytalk-oci ubuntu@145.241.224.13:~/shytalk-api/.env /tmp/shytalk-api.env
scp -i ~/.ssh/shytalk-oci /tmp/shytalk-api.env ubuntu@<SINGAPORE_IP>:~/shytalk-api/.env
rm /tmp/shytalk-api.env
```

Copy the Firebase service account key:
```bash
# Check the exact path from London's .env first
ssh -i ~/.ssh/shytalk-oci ubuntu@145.241.224.13 "grep SERVICE_ACCOUNT ~/shytalk-api/.env"
# Then copy the key file
scp -i ~/.ssh/shytalk-oci ubuntu@145.241.224.13:~/shytalk-api/<service-account-file>.json /tmp/sa-key.json
scp -i ~/.ssh/shytalk-oci /tmp/sa-key.json ubuntu@<SINGAPORE_IP>:~/shytalk-api/<service-account-file>.json
rm /tmp/sa-key.json
```

**Step 5: Verify .env has all required variables**

SSH into Singapore and check:
```bash
ssh -i ~/.ssh/shytalk-oci ubuntu@<SINGAPORE_IP>
cat ~/shytalk-api/.env
```

Required variables (all should be present):
- `PORT=3000`
- `FIREBASE_SERVICE_ACCOUNT_PATH` or `GOOGLE_APPLICATION_CREDENTIALS` → path to JSON key
- `FIREBASE_DATABASE_URL` → `https://shytalk-7ba69-default-rtdb.asia-southeast1.firebasedatabase.app`
- `FIREBASE_PROJECT_ID` → `shytalk-7ba69`
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`
- `R2_BUCKET_NAME` → `shytalk-media`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `ALLOWED_ORIGINS` → comma-separated list of allowed CORS origins
- `CDN_URL` → `https://images.shytalk.shyden.co.uk` (optional, has default)
- `LIBRETRANSLATE_URL` (optional, defaults to localhost)

**Step 6: Start PM2**

```bash
cd ~/shytalk-api
pm2 start ecosystem.config.js
pm2 logs shytalk-api --lines 20
# Expected: "Server running on port 3000" and no errors
```

**Step 7: Quick smoke test (direct via IP)**

```bash
curl http://localhost:3000/api/config
# Expected: JSON response with config data
curl http://localhost:3000/api/fun-facts
# Expected: JSON array of fun facts
```

**Step 8: Set up PM2 auto-start on reboot**

```bash
pm2 save
pm2 startup
# Copy and run the command PM2 prints (it will be a sudo command)
```

---

### Task 4: Test Singapore Server Thoroughly

**Step 1: Run the Express API test suite on Singapore**

```bash
ssh -i ~/.ssh/shytalk-oci ubuntu@<SINGAPORE_IP>
cd ~/shytalk-api
npm install --include=dev  # Need devDependencies for tests
npx jest --forceExit
# Expected: 331 passed, 3 failed (pre-existing)
npm prune --production  # Clean up devDependencies after testing
```

**Step 2: Test cron jobs are registered**

```bash
pm2 logs shytalk-api --lines 50 | grep -i cron
# Expected: Log lines showing cron job registrations
```

**Step 3: Verify Firestore connectivity**

```bash
curl http://localhost:3000/api/config
# Expected: 200 OK with config data (proves Firestore reads work)
```

**Step 4: Verify R2 connectivity**

```bash
curl http://localhost:3000/api/storage/health 2>/dev/null || echo "No health endpoint — check PM2 logs for R2 errors"
pm2 logs shytalk-api --lines 100 | grep -i "r2\|s3\|storage"
# Expected: No errors related to R2/S3
```

**Step 5: Measure latency improvement**

```bash
# On Singapore VM — measure Firestore round trip
time curl -s http://localhost:3000/api/config > /dev/null
# Expected: real ~0.05s (vs ~0.2s from London)

# On London VM for comparison
ssh -i ~/.ssh/shytalk-oci ubuntu@145.241.224.13 "time curl -s http://localhost:3000/api/config > /dev/null"
# Expected: real ~0.2s
```

---

### Task 5: Switch DNS to Singapore

**Step 1: Start Caddy on Singapore (before DNS switch)**

```bash
ssh -i ~/.ssh/shytalk-oci ubuntu@<SINGAPORE_IP>
sudo systemctl start caddy
sudo systemctl enable caddy
```

Note: Caddy will fail to get a TLS cert until DNS points here. That's fine — it will retry.

**Step 2: Update DNS in Cloudflare**

- Log in to Cloudflare Dashboard → select `shyden.co.uk` domain
- Go to DNS → Records
- Find the A record for `api.shytalk` (currently `145.241.224.13`)
- Change the **IPv4 address** to `<SINGAPORE_IP>`
- Keep **Proxy status** ON (orange cloud)
- Save

**Step 3: Wait for Caddy to provision TLS cert**

```bash
ssh -i ~/.ssh/shytalk-oci ubuntu@<SINGAPORE_IP>
sudo journalctl -u caddy -f
# Watch for "certificate obtained successfully" message
# This may take 1-2 minutes after DNS propagates
```

**Step 4: Verify production traffic flows through Singapore**

```bash
# From your local machine
curl -s https://api.shytalk.shyden.co.uk/api/config | head -c 200
# Expected: JSON response

# On Singapore VM — confirm requests are arriving
pm2 logs shytalk-api --lines 5
# Expected: Recent request logs with timestamps
```

**Step 5: Test on a real Android device**

- Open ShyTalk app
- Browse rooms, join a room, send a gift, open backpack
- Send a private message
- Check that everything works as before

---

### Task 6: Monitor and Decommission London

**Step 1: Monitor Singapore for 24-48 hours**

Check periodically:
```bash
ssh -i ~/.ssh/shytalk-oci ubuntu@<SINGAPORE_IP>
pm2 status          # Process should be "online"
pm2 logs --lines 20 # No errors
free -h              # Memory usage reasonable
uptime               # Load average under 1.0
```

**Step 2: Stop London API (after 48h stable)**

```bash
ssh -i ~/.ssh/shytalk-oci ubuntu@145.241.224.13
pm2 stop shytalk-api
pm2 delete shytalk-api
```

**Step 3: Update project documentation**

Modify: `MEMORY.md`
- Change VM IP from `145.241.224.13` to `<SINGAPORE_IP>`
- Change region from `uk-london-1` to `ap-singapore-1`
- Update SSH command
- Note the upgrade: 1 OCPU/1GB → 4 OCPUs/24GB ARM

```bash
git add -A && git commit -m "docs: update MEMORY.md with Singapore VM details"
```

**Step 4: Terminate London VM (after 1 week)**

- Oracle Cloud Console → Compute → Instances → `shytalk-api` (London)
- Actions → Terminate
- Check "Permanently delete boot volume"
- Confirm

---

## Rollback Procedure

If anything goes wrong after DNS switch:

1. **Immediate (< 30 seconds):** Go to Cloudflare DNS → change A record back to `145.241.224.13`
2. **Verify:** `curl https://api.shytalk.shyden.co.uk/api/config` returns data
3. **Investigate:** Check Singapore PM2 logs for the issue
4. **Fix and retry:** Address the issue, then switch DNS back to Singapore

London VM stays running for 48h specifically to enable this rollback.
