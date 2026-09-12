---
name: deploy-uniflex
description: >-
  Build, test, cross-compile, and deploy updated Uniflex standalone binaries to the
  arcadia host (192.168.1.36) running the uniflex systemd user service. Use whenever
  the user asks to build, release, or deploy Uniflex updates to the server.
---

# Deploy Uniflex Binary to Arcadia (192.168.1.36)

This runbook details how to cross-compile the Uniflex single-binary executable for Linux x64, transfer it to the hosting server, perform an atomic replacement with automatic backup, restart the systemd service, and verify health.

## Server Environment Summary
- **Host**: `192.168.1.36` (`arcadia`)
- **SSH User**: `nabeeladzan` (configured via `~/.ssh/config` and `id_ed25519`)
- **Remote Directory**: `/home/nabeeladzan/uniflex`
- **Service**: `uniflex.service` (systemd user unit: `~/.config/systemd/user/uniflex.service`)
- **Ports**: HTTP API `2024`, SFU UDP audio `40000`

---

## Step-by-Step Deployment Procedure

### 1. Verification & Tests
Ensure all unit and integration tests pass before building:
```bash
cd c:\Users\nabeeladzan\Projects\nextphase\uniflex
bun test
```

### 2. Cross-Compile for Linux x64
Compile the standalone Linux binary using Bun:
```bash
bun scripts/build.ts linux
```
*Output binary*: `c:\Users\nabeeladzan\Projects\nextphase\uniflex\uniflex-linux`

### 3. Stage Binary on Server
Transfer the compiled binary to a staging file on the remote server:
```bash
scp uniflex-linux 192.168.1.36:/home/nabeeladzan/uniflex/uniflex.new
```

### 4. Atomic Backup, Swap, and Service Restart
Execute the atomic backup, replacement, permission setting, and service restart via SSH:
```bash
ssh 192.168.1.36 "
  cp /home/nabeeladzan/uniflex/uniflex /home/nabeeladzan/uniflex/uniflex.bak && \
  mv /home/nabeeladzan/uniflex/uniflex.new /home/nabeeladzan/uniflex/uniflex && \
  chmod +x /home/nabeeladzan/uniflex/uniflex && \
  systemctl --user restart uniflex
"
```

### 5. Health Verification
Verify service status and HTTP response:
```bash
ssh 192.168.1.36 "
  systemctl --user is-active uniflex && \
  curl -fsS http://127.0.0.1:2024/ && \
  journalctl --user -u uniflex -n 15 --no-pager
"
```

### 6. Emergency Rollback (If Verification Fails)
If the service fails to start or health check returns non-200:
```bash
ssh 192.168.1.36 "
  mv /home/nabeeladzan/uniflex/uniflex.bak /home/nabeeladzan/uniflex/uniflex && \
  systemctl --user restart uniflex && \
  systemctl --user status uniflex
"
```
