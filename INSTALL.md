# Installing pi-chatbot on Debian

Native install with an optional systemd service. You supply a Postgres
connection string; the bundled **brave-search** skill ships with the repo and
needs only a `BRAVE_API_KEY`.

## Prerequisites

- Debian/Ubuntu with `sudo`
- **Node.js 20+** (e.g. via NodeSource):
  ```bash
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
  ```
- `python3`, `curl`, `git` (the setup script installs these if missing)
- A reachable **Postgres** database and its connection string
- A **Brave Search API key** — https://api-dashboard.search.brave.com/ (optional;
  web search is disabled without it)

## 1. Get the code

```bash
git clone https://github.com/T0mSIlver/pi-chatbot.git /opt/pi-chatbot
cd /opt/pi-chatbot
```

## 2. Run setup

Interactive (prompts for `POSTGRES_URL` and `BRAVE_API_KEY`):

```bash
bash scripts/setup.sh
```

Or non-interactive:

```bash
POSTGRES_URL='postgres://user:pass@host:5432/db' \
BRAVE_API_KEY='your-brave-key' \
bash scripts/setup.sh
```

The script installs prerequisites, runs `pnpm install`, writes `.env.local`
(generating `AUTH_SECRET`), applies database migrations, and builds the app.
It is safe to re-run — an existing `.env.local` is left untouched.

## 3. Run it

Foreground:

```bash
pnpm start    # http://localhost:3000
```

### As a systemd service

```bash
# Fill in the User and WorkingDirectory placeholders, then install:
sudo sed -e "s|__USER__|$USER|g" -e "s|__WORKDIR__|$PWD|g" \
  deploy/pi-chatbot.service | sudo tee /etc/systemd/system/pi-chatbot.service >/dev/null

sudo systemctl daemon-reload
sudo systemctl enable --now pi-chatbot
sudo systemctl status pi-chatbot
journalctl -u pi-chatbot -f      # logs
```

If systemd can't find `node`/`pnpm`, run `which node pnpm` and prepend that
directory to the `Environment=PATH=` line in the unit file.

## Web search (brave-search skill)

The skill lives in [`skills/brave-search/`](skills/brave-search/) and is loaded
directly from the repo by the app (`lib/pi/session.ts`) — nothing is copied into
`~/.pi`. At runtime it needs:

- `BRAVE_API_KEY` in `.env.local` (Next loads it into the server environment)
- `python3` and `curl` on the host

Verify the script independently:

```bash
BRAVE_API_KEY=your-key bash skills/brave-search/search.sh "test query" 3
```

## The Pi model backend

Chat runs through the Pi coding agent. The model/provider definitions are
**bundled with the app** at [`config/pi-models.json`](config/pi-models.json) and
loaded automatically (`lib/pi/session.ts`) — the same models that work here work
on the deployed box, with nothing to configure in `~/.pi`. Override the file with
`PI_CHATBOT_MODELS_FILE` if needed.

The bundled provider (`llamacpp`) points at `http://llama-router.vpn/v1` with no
API key, so the **only requirement is that the Debian machine can reach that
router** (e.g. it is on the same VPN). Verify:

```bash
curl -fsS http://llama-router.vpn/v1/models && echo OK
```

If your provider needs an API key, set it in `~/.pi/agent/auth.json` (this file
is not bundled). The default model id and the in-app model list live in
`lib/ai/models.ts`.

## Updating

```bash
git pull
bash scripts/setup.sh        # reinstalls deps, migrates, rebuilds
sudo systemctl restart pi-chatbot
```
