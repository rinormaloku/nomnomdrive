#!/usr/bin/env bash
set -euo pipefail
ufw allow OpenSSH
ufw allow 80/tcp    # HTTP (ACME challenge + redirect)
ufw allow 443/tcp   # HTTPS
ufw --force enable
ufw status verbose
