# Deploy OpenCity to a VPS

Target: `https://opencity.basharkhan.com` on a fresh Ubuntu 22.04/24.04 VPS, served by nginx as a reverse proxy in front of the game's Node static server (PM2). TLS via Let's Encrypt.

## 0. DNS setup (do first, do this at your DNS provider)

The game is served from a subdomain. Add an **A record** for `opencity` pointing at your VPS public IP:

| Type | Name            | Value   | TTL  |
|------|-----------------|---------|------|
| A    | opencity        | 1.2.3.4 | 300  |

`1.2.3.4` = your VPS IP. Wait a few minutes, then verify:

```bash
dig +short opencity.basharkhan.com   # on any machine, must print the VPS IP
```

Also make sure your VPS **security group / cloud firewall** allows inbound TCP 80, 443 (and 22 for SSH).

## 1. Base packages on the VPS

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y nginx nodejs npm certbot python3-certbot-nginx git
sudo ufw allow OpenSSH && sudo ufw allow 'Nginx Full' && sudo ufw enable
```

Check Node is new enough to run the server (it uses `node:` prefix imports, ESM, optional chaining):

```bash
node -v   # want v18+; if older than 18, install Node 20+ via NodeSource:
# curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt install -y nodejs
```

## 2. Global tooling

```bash
sudo npm install -g pm2
sudo pm2 startup systemd    # enable pm2 to boot on reboot (prints a command — run it)
```

## 3. Get the code

```bash
sudo mkdir -p /srv && sudo chown $USER /srv
cd /srv
git clone https://github.com/Basharkhan7776/opencity.git
cd opencity
npm install        # installs three into ./node_modules — REQUIRED, the page imports it at /node_modules/...
```

Sanity check locally before going further:

```bash
npm run serve &                      # listens on 8123
curl -sI http://localhost:8123/ | head -1        # expect 200
curl -sI http://localhost:8123/node_modules/three/build/three.module.js | head -1
kill %1
```

## 4. Run the game server under PM2

```bash
cd /srv/opencity
pm2 start "node tools/serve.mjs 8123" --name opencity
pm2 save                     # persist the process list (with the startup hook from §2)
```

Verify:

```bash
pm2 status                    # opencity → online
curl -sI http://localhost:8123/ | head -1
```

The app's HTTP port is only ever reached via nginx on the loopback; it is not exposed publicly.

## 5. nginx reverse proxy

Create the site config:

```bash
sudo nano /etc/nginx/sites-available/opencity
```

```nginx
server {
    listen 80;
    server_name opencity.basharkhan.com;

    location / {
        proxy_pass http://127.0.0.1:8123;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable and test:

```bash
sudo ln -s /etc/nginx/sites-available/opencity /etc/nginx/sites-enabled/opencity
sudo nginx -t
sudo systemctl reload nginx
```

At this point `http://opencity.basharkhan.com/` should load the game.

## 6. TLS certificate (Let's Encrypt via certbot)

```bash
sudo certbot --nginx -d opencity.basharkhan.com
```

certbot installs the cert, rewrites the nginx server block to listen on 443, adds an HTTP→HTTPS redirect, and sets up auto-renewal.

Verify:

```bash
sudo certbot renew --dry-run          # renewal is configured
curl -sI https://opencity.basharkhan.com/ | head -1   # expect 200, TLS handshake
```

Renewal runs automatically via a systemd timer (`systemctl list-timers | grep certbot`); nothing further to do.

## 7. Deployment updates

```bash
cd /srv/opencity
git pull
npm install        # re-run if package.json/lockfile changed
pm2 restart opencity
```

## Troubleshooting

- **`curl` from VPS works but browser times out** → cloud firewall / security group isn't allowing 80/443 (see §0/§1).
- **502 Bad Gateway** → the game server isn't up. `pm2 status`, `pm2 logs opencity --lines 50`, then `pm2 restart opencity`.
- **Mixed content / page refuses to load modules** → always open `https://...`, never plain HTTP; the import map in `index.html` loads `/node_modules/...` which must come from the same origin.
- **Certbot can't issue the cert** → DNS hasn't propagated (re-check §0 `dig`) or port 80 is blocked.
- **App state lost on reboot** → confirm `sudo pm2 startup systemd` from §2 was actually run (it prints a `sudo env ...` command), and that `pm2 save` was run.

## Files touched on the server

- `/srv/opencity` — app checkout
- `/etc/nginx/sites-available/opencity` (+ symlink in `sites-enabled`) — nginx config
- PM2 process `opencity` — runs `node tools/serve.mjs 8123`
