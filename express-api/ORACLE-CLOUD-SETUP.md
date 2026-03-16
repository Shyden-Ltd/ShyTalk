# Oracle Cloud VM Setup — Complete Field-by-Field Guide

## 1. Create Oracle Cloud Account

1. Go to [cloud.oracle.com](https://cloud.oracle.com) → **Sign Up**
2. Fill in name, email, country, set a password
3. Verify email, add a payment method (credit card required for identity verification — you will NOT be charged on the Always Free tier)
4. Choose your **Home Region** — pick the one closest to your users (e.g., `UK South (London)` for UK). **This cannot be changed later** and determines where your free-tier resources live.
5. Wait for account provisioning (can take up to 30 minutes)

## 2. Create a Compute Instance

Go to **Hamburger menu → Compute → Instances → Create Instance**

### Section 1: Name and compartment

| Field                     | What to set                              |
| ------------------------- | ---------------------------------------- |
| **Name**                  | `shytalk-api`                            |
| **Create in compartment** | Leave as your root compartment (default) |

### Section 2: Placement

| Field                   | What to set                                                     |
| ----------------------- | --------------------------------------------------------------- |
| **Availability domain** | Leave as default (AD-1). Free tier regions typically have 1 AD. |
| **Capacity type**       | Leave as **On-demand capacity** (default)                       |
| **Fault domain**        | Leave as **Let Oracle choose the best fault domain** (default)  |

### Section 3: Security (Shielded Instance)

| Field                 | What to set                                                                         |
| --------------------- | ----------------------------------------------------------------------------------- |
| **Shielded instance** | Leave **unchecked** (default). Shielded instances are not available for ARM shapes. |

### Section 4: Image and shape

Click **Edit** to change from the default.

**Image:**

| Field           | What to set                                                                                                                        |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **Image**       | **Canonical Ubuntu 24.04** (click "Change image" → Ubuntu → select 24.04 Minimal aarch64). You want the **aarch64** (ARM) version. |
| **Image build** | Leave as latest (default)                                                                                                          |

**Shape:**

Click **Change shape**.

| Field                     | What to set                                                                                            |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Shape series**          | Select **Ampere** (ARM-based processors — this is the free tier)                                       |
| **Shape name**            | **VM.Standard.A1.Flex** (this is the Always Free eligible shape)                                       |
| **Number of OCPUs**       | **2** (free tier allows up to 4 total across all A1 instances; 2 is plenty)                            |
| **Amount of memory (GB)** | **12** (auto-calculated: 6GB per OCPU, so 2 OCPUs = 12GB. You can set up to 24GB if using all 4 OCPUs) |

> You'll see a green banner: **"Always Free eligible"** — make sure this appears.

### Section 5: Primary VNIC information (Networking)

| Field                     | What to set                                                                               |
| ------------------------- | ----------------------------------------------------------------------------------------- |
| **Virtual cloud network** | If you have no VCN yet, select **Create new virtual cloud network**                       |
| **New VCN name**          | `shytalk-vcn` (or leave default)                                                          |
| **Subnet**                | Select **Create new public subnet**                                                       |
| **New subnet name**       | `shytalk-subnet` (or leave default)                                                       |
| **Public IPv4 address**   | Select **Assign a public IPv4 address** (REQUIRED — this is how you'll connect to the VM) |
| **Private IPv4 address**  | Leave **Automatically assign private IPv4 address** (default)                             |
| **IPv6 addresses**        | Leave **unchecked** (default)                                                             |
| **DNS**                   | Leave defaults                                                                            |

> If a VCN already exists, select it and pick the public subnet.

### Section 6: Add SSH keys

| Field        | What to set                                                                                                                                                                                                                                                                                   |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SSH keys** | Select **Generate a key pair for me**, then **IMMEDIATELY click "Save private key" and "Save public key"**. Store these files safely — you need the private key to SSH into the VM. If you already have an SSH key pair, choose **Upload public key files** or **Paste public keys** instead. |

**CRITICAL: If you lose the private key, you cannot SSH into the instance. Download it NOW.**

### Section 7: Boot volume

| Field                                              | What to set                                                                                                           |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| **Specify a custom boot volume size**              | Leave **unchecked** (default gives 46.6 GB, which is plenty). Free tier allows up to 200GB total but default is fine. |
| **Use in-transit encryption**                      | Leave **unchecked** (default)                                                                                         |
| **Encrypt this volume with a key that you manage** | Leave **unchecked** (default — uses Oracle-managed encryption)                                                        |

### Section 8: Advanced options (click to expand — leave all defaults)

| Field                                  | What to set                                                                      |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| **Initialization script (Cloud-init)** | Leave blank (we'll configure manually via SSH)                                   |
| **Oracle Cloud Agent plugins**         | Leave all defaults (Vulnerability Scanning, OS Management, etc. are pre-checked) |
| **Availability configuration**         | Leave as **Restore instance lifecycle state** (default)                          |
| **Capacity reservation**               | Leave as **No reservation** (default)                                            |
| **Launch mode**                        | Leave as **Paravirtualized** (default)                                           |

### Create the Instance

Click **Create**. The instance will provision in 1-5 minutes. The status will go from PROVISIONING → RUNNING.

**Copy the Public IP address** from the Instance Details page — you'll need it for everything below.

## 3. Open Firewall Ports (REQUIRED)

Oracle Cloud has a firewall at the VCN level. You must open ports 80 and 443 for HTTP/HTTPS.

1. Go to **Instance Details → Primary VNIC → Subnet** (click the subnet link)
2. Click the **Default Security List**
3. Click **Add Ingress Rules** and add these two rules:

| Field                      | Rule 1            | Rule 2            |
| -------------------------- | ----------------- | ----------------- |
| **Source Type**            | CIDR              | CIDR              |
| **Source CIDR**            | `0.0.0.0/0`       | `0.0.0.0/0`       |
| **IP Protocol**            | TCP               | TCP               |
| **Source Port Range**      | Leave blank (All) | Leave blank (All) |
| **Destination Port Range** | `80`              | `443`             |
| **Description**            | HTTP              | HTTPS             |

Click **Add Ingress Rules** for each.

> Port 22 (SSH) is open by default in the security list.

## 4. SSH into the VM

```bash
# If you generated keys in Oracle Cloud:
ssh -i /path/to/downloaded-private-key.key ubuntu@<PUBLIC_IP>

# First time: type "yes" to accept the fingerprint
```

On Windows, you can use Git Bash, PowerShell, or PuTTY. If using the downloaded `.key` file on Windows:

```bash
# Git Bash:
chmod 600 /path/to/key.key
ssh -i /path/to/key.key ubuntu@<PUBLIC_IP>
```

## 5. Open iptables firewall (Ubuntu-level)

Oracle Ubuntu images have iptables rules that block ports 80/443 by default:

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

## 6. Install Node.js 20, PM2, Caddy

```bash
# Node.js 20 via NodeSource
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verify
node -v   # v20.x.x
npm -v    # 10.x.x

# PM2 (process manager)
sudo npm install -g pm2

# Caddy (reverse proxy with auto HTTPS)
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install caddy
```

## 7. DNS

Add an A record for your domain:

| Type | Name                       | Value         | TTL |
| ---- | -------------------------- | ------------- | --- |
| A    | `api.shytalk.shyden.co.uk` | `<PUBLIC_IP>` | 300 |

Set this in your DNS provider (Cloudflare DNS). Set the proxy status to **DNS only** (grey cloud), NOT proxied — Caddy handles HTTPS itself.

## 8. Upload code to VM

From your local machine:

```bash
# From the ShyTalk project root:
scp -i /path/to/key.key -r express-api ubuntu@<PUBLIC_IP>:~/express-api
```

Or use `git clone` if you've pushed the express-api code to your repo.

## 9. Set up environment on VM

```bash
cd ~/express-api

# Install dependencies
npm install

# Create the Firebase service account key file
# Option A: SCP from local machine
# Option B: Create it on the VM:
nano firebase-service-account.json
# Paste your Firebase service account JSON
# (Firebase Console → Project Settings → Service Accounts → Generate New Private Key)

# Create .env file
nano .env
```

**.env contents:**

```env
FIREBASE_SERVICE_ACCOUNT_PATH=/home/ubuntu/express-api/firebase-service-account.json
FIREBASE_PROJECT_ID=<your-firebase-project-id>
FIREBASE_DATABASE_URL=https://<your-project-id>-default-rtdb.firebaseio.com
R2_ACCOUNT_ID=9315582c39b627dca58dfa83602db385
R2_ACCESS_KEY_ID=<your R2 access key>
R2_SECRET_ACCESS_KEY=<your R2 secret key>
R2_BUCKET_NAME=shytalk-media
LIVEKIT_API_KEY=<your LiveKit API key>
LIVEKIT_API_SECRET=<your LiveKit API secret>
LIVEKIT_HOST=<your LiveKit server URL>
NODE_ENV=production
PORT=3000
```

To get R2 credentials: Cloudflare Dashboard → R2 → Manage R2 API Tokens → Create API token (with read/write to `shytalk-media`).

## 10. Configure Caddy

```bash
sudo nano /etc/caddy/Caddyfile
```

Replace contents with:

```
api.shytalk.shyden.co.uk {
    reverse_proxy localhost:3000
}
```

```bash
sudo systemctl restart caddy
```

Caddy will automatically obtain and renew Let's Encrypt TLS certificates.

## 11. Start with PM2

```bash
cd ~/express-api

# Start with PM2
pm2 start ecosystem.config.js

# Verify it's running
pm2 status
pm2 logs shytalk-api --lines 50

# Save PM2 process list so it survives reboots
pm2 save

# Set PM2 to start on boot
pm2 startup
# Run the command it prints (sudo env PATH=... pm2 startup ...)
```

## 12. Verify

```bash
# From your local machine:
curl https://api.shytalk.shyden.co.uk/api/health
# Should return: {"status":"ok","timestamp":...}
```

## Testing Checklist

1. **Health check**: `curl https://api.shytalk.shyden.co.uk/api/health` → `{"status":"ok"}`
2. **Admin panel**: Temporarily change `API_BASE` in `public/admin/index.html` to `https://api.shytalk.shyden.co.uk` and test all tabs
3. **Android app**: Set `API_BASE_URL` build config to `https://api.shytalk.shyden.co.uk`, run the app, test login, rooms, chat, economy
4. **Check PM2 logs**: `pm2 logs shytalk-api` — look for errors
5. **Cron jobs**: After midnight UTC, check logs for cron execution: `pm2 logs shytalk-api --lines 200 | grep "cron"`
