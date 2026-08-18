# SmartAttendanceSystem Concurrency Setup

This setup runs the backend in PM2 cluster mode and shares Socket.IO, QR state, scan grants, rate limits, and mobile location capture state through Redis.

## 1. Start Redis

Docker:

```bash
docker run -d --name smart-attendance-redis -p 6379:6379 redis:7-alpine
```

Ubuntu/Debian:

```bash
sudo apt update
sudo apt install redis-server
sudo systemctl enable --now redis-server
```

macOS:

```bash
brew install redis
brew services start redis
```

## 2. Configure Environment

In `server/.env`, set:

```env
NODE_ENV=production
REDIS_URL=redis://127.0.0.1:6379
JWT_SECRET=replace-with-at-least-32-characters
QR_SECRET=replace-with-at-least-32-characters
MONGO_URI=mongodb://127.0.0.1:27017/smart_attendance_system
PORT=4000
HOST=0.0.0.0
```

Redis is required for production clustering because QR state and scan grants must be shared across workers.

## 3. Start PM2 Cluster

Install PM2 once:

```bash
npm install -g pm2
```

Start the backend:

```bash
pm2 start ecosystem.config.cjs --env production
pm2 status
pm2 logs smart-attendance-api
```

Reload after code changes:

```bash
pm2 reload smart-attendance-api --update-env
```

## 4. Enable Nginx Reverse Proxy

Copy `nginx.conf` to your Nginx site config, or merge the server block into your existing config.

Ubuntu example:

```bash
sudo cp nginx.conf /etc/nginx/sites-available/smart-attendance
sudo ln -s /etc/nginx/sites-available/smart-attendance /etc/nginx/sites-enabled/smart-attendance
sudo nginx -t
sudo systemctl reload nginx
```

The `/socket.io/` location includes WebSocket upgrade headers and disables proxy buffering for real-time attendance events.
