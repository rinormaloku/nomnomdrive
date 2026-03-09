# VM Provisioning Guide

Sets up the VM to serve `cloud.nomnomdrive.com` with Caddy as a TLS-terminating reverse proxy in front of the NestJS cloud server.

## Prerequisites

- Ubuntu 22.04+
- DNS A record for `cloud.nomnomdrive.com` pointing to this VM's public IP — must be live before starting Caddy, otherwise the Let's Encrypt ACME challenge fails
- `.env` file in the repo root (not in `packages/cloud`) — see `.env.example`

---

## 1. Install Docker (run as root)

```bash
bash infra/scripts/04-install-docker.sh
```

Installs Docker CE and the `docker compose` plugin from the official Docker apt repo.

If you want to run `docker compose` without `sudo`, add your user to the docker group and re-login:

```bash
usermod -aG docker $USER
```

---

## 2. Install Caddy (run as root)

```bash
bash infra/scripts/01-install-caddy.sh
```

Installs Caddy from the official apt repo and enables it as a systemd service.

---

## 3. Configure Firewall (run as root)

```bash
bash infra/scripts/02-setup-firewall.sh
```

Opens ports 22 (SSH), 80 (HTTP / ACME challenge), and 443 (HTTPS). Port 3030 is intentionally not opened — UFW blocks external access to the cloud server.

---

## 4. Deploy Caddyfile (run as root)

```bash
bash infra/scripts/03-deploy-caddyfile.sh
```

Copies `infra/caddy/Caddyfile` to `/etc/caddy/Caddyfile`, validates it, and reloads Caddy. TLS is provisioned automatically by Let's Encrypt on first request. HTTP→HTTPS redirect is implicit.

---

## 5. Clone the Repo

```bash
git clone <repo-url> nomnomdrive
cd nomnomdrive
```

---

## 6. Configure Environment

The `.env` file lives in the **repo root** (not in `packages/cloud`). Copy the example and fill in values:

```bash
cp .env.example .env
# edit .env — set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, JWT_SECRET, SERVER_URL
```

`SERVER_URL` should be `https://cloud.nomnomdrive.com`.

`docker compose` automatically picks up `.env` from the directory where it is run (repo root).

---

## Production: Run with Docker

No Node or pnpm needed on the host. The Dockerfile builds everything inside the container.

```bash
docker compose up -d
```

This builds the cloud image (shared + cloud packages compiled inside Docker), starts PostgreSQL, and runs the NestJS server on port 3030. Caddy proxies HTTPS traffic to it.

To update after a code change:

```bash
git pull
docker compose up -d --build
```

---

## Dev: Run Locally

Only needed if you want to run `pnpm dev:cloud` on the VM instead of Docker.

### Install Node + pnpm (run as your dev user, not root)

```bash
bash infra/scripts/05-install-node.sh
```

Then add fnm to your shell profile as printed by the script, and open a new shell.

### Install dependencies and run

```bash
pnpm install
pnpm dev:cloud   # builds shared, then runs NestJS with ts-node in watch mode
```

`dev:cloud` uses `dotenv -e ../../.env` (relative to `packages/cloud`), which resolves to the repo root `.env`. PostgreSQL still needs to be running — you can start just that service with:

```bash
docker compose up -d postgres
```

---

## Verify

```bash
# Caddy and TLS
curl -I https://cloud.nomnomdrive.com

# Cloud server reachable through proxy
curl https://cloud.nomnomdrive.com/.well-known/oauth-authorization-server | jq .

# Caddy status
systemctl status caddy

# Cloud container logs
docker compose logs -f cloud
```

---

## Notes

- **WebSocket:** The `/tunnel` endpoint works transparently — Caddy's `reverse_proxy` handles WebSocket upgrades automatically.
- **Port 3030:** Bound to all host interfaces by Docker, but UFW blocks external access. Do not add a UFW rule for 3030.
- **Landing page:** `nomnomdrive.com` is commented out in the Caddyfile. Uncomment and configure when ready.
