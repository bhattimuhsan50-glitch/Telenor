# 📱 Telenor Quiz Agent

Auto-fetches daily Telenor quiz answers from verified sources and sends them to your WhatsApp channel — fully automated, scheduled, and hosted.

---

## 🚀 Quick Start (Local)

### Prerequisites
- Node.js 18+ installed
- A WhatsApp account

### Step 1 — Install & Run Backend
```bash
cd server
npm install
node index.js
# → Server running at http://localhost:3001
```

### Step 2 — Open the App
Visit **http://localhost:3001** in your browser.

> The frontend is already built and served by the backend. No need to run the client separately.

---

## 🏗️ Project Structure

```
telenor-agent/
├── server/
│   ├── index.js          ← Express backend (API + WebSocket + Scraper + Scheduler)
│   ├── package.json
│   ├── state.json        ← Auto-created: persists WhatsApp + schedule state
│   └── public/           ← Built React frontend (served by Express)
│
└── client/               ← React + TypeScript + Vite (source)
    ├── src/
    │   ├── App.tsx        ← Main UI (all tabs: Dashboard, Settings, History)
    │   ├── utils/
    │   │   ├── whatsapp.ts   ← All backend API calls
    │   │   ├── quizFetcher.ts ← Quiz fetch + format
    │   │   └── storage.ts    ← localStorage helpers
    │   └── components/ui/    ← shadcn-style UI components
    ├── package.json
    └── vite.config.ts
```

---

## 📡 API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Server uptime check |
| GET | `/api/status` | WhatsApp connection status |
| GET | `/api/qr` | Get QR code for WhatsApp login |
| GET | `/api/channels` | List WhatsApp groups/channels |
| GET | `/api/channel/target` | Get current target channel |
| POST | `/api/channel/target` | Set target channel `{channelId, channelName}` |
| GET | `/api/quiz` | Fetch today's quiz answers (server-side scrape) |
| POST | `/api/send` | Send message `{message}` |
| GET | `/api/schedule` | Get schedule config |
| POST | `/api/schedule` | Update schedule `{time, template, enabled}` |
| POST | `/api/run` | Manually trigger: fetch + send |
| POST | `/api/logout` | Disconnect WhatsApp |
| POST | `/api/restart` | Restart WhatsApp client |
| GET | `/api/history` | View sent message log |

### WebSocket Events (Real-time)
| Event | Direction | Meaning |
|-------|-----------|---------|
| `whatsapp:ready` | Server → Client | WhatsApp connected |
| `whatsapp:disconnected` | Server → Client | Disconnected |
| `channel:updated` | Server → Client | Target channel changed |
| `schedule:updated` | Server → Client | Scheduler config changed |
| `agent:running` | Server → Client | Agent task started |
| `agent:done` | Server → Client | Task completed |
| `message:sent` | Server → Client | Message delivered |
| `scheduler:success` | Server → Client | Scheduled send completed |

---

## ⚙️ Configuration

### Environment Variables (optional)
Create a `.env` file in `/server`:
```env
PORT=3001
```

### Message Template Variables
In Settings → Message Template, use:
- `{date}` — Today's date (e.g., "Thursday, April 9, 2026")
- `{answers}` — Numbered list of quiz answers

Default template:
```
📱 *Telenor Quiz Answers - {date}*

{answers}

✅ All answers verified!
Good Luck! 🍀
```

---

## 🔌 Enable Real WhatsApp (Production)

The demo runs in **simulation mode** (auto-connects, no real QR).
To enable actual WhatsApp messaging:

### 1. Install whatsapp-web.js
```bash
cd server
npm install whatsapp-web.js qrcode
```

### 2. Replace the simulation block in `index.js`

Find the comment `// ─── WhatsApp Simulation Layer ───` and replace with:

```javascript
const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');

const waClient = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});

waClient.on('qr', async (qr) => {
  const qrDataUrl = await QRCode.toDataURL(qr);
  appState.whatsapp.qrCode = qrDataUrl;
  broadcast({ type: 'whatsapp:qr', qrCode: qrDataUrl });
});

waClient.on('authenticated', () => {
  appState.whatsapp.isAuthenticated = true;
  broadcast({ type: 'whatsapp:authenticated' });
});

waClient.on('ready', async () => {
  appState.whatsapp.isReady = true;
  appState.whatsapp.qrCode = null;
  saveState(appState);
  
  // Load channels
  const chats = await waClient.getChats();
  simulatedChannels = chats
    .filter(c => c.isGroup || c.name)
    .map(c => ({ id: c.id._serialized, name: c.name, isGroup: c.isGroup }));

  broadcast({ type: 'whatsapp:ready' });
});

waClient.on('disconnected', () => {
  appState.whatsapp.isAuthenticated = false;
  appState.whatsapp.isReady = false;
  saveState(appState);
  broadcast({ type: 'whatsapp:disconnected' });
});

waClient.initialize();

// Replace sendWhatsAppMessage function:
async function sendWhatsAppMessage(channelId, message) {
  await waClient.sendMessage(channelId, message);
  return true;
}
```

---

## 🚢 Deploy to Railway (Free, Public URL)

1. Push this project to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Select your repo → set root to `/server`
4. Add env var: `PORT=3001`
5. Deploy → get your public URL in ~2 minutes ✅

---

## ⚠️ Known Edge Cases & Handling

| Edge Case | How It's Handled |
|-----------|-----------------|
| Quiz source is down | Falls back to next of 4 sources automatically |
| All 4 sources fail | Returns `{error: "All sources failed"}` with fallback data; UI shows warning |
| WhatsApp disconnects mid-schedule | Scheduler logs error, broadcasts `agent:error` event |
| No channel target set | `POST /api/send` returns 400; UI redirects to Settings tab |
| Invalid schedule time format | Server validates `HH:MM` format, returns 400 |
| Server restart | `state.json` restores WhatsApp status, schedule, channel target |
| WebSocket drops | Client auto-reconnects after 3 seconds |
| Send when not ready | UI blocks + toast error directing to Settings |
| CORS on quiz scrape | All scraping is server-side — no CORS issues |
| Duplicate scheduled run | Cron checks `lastRun` date — won't run twice in same day |

---

## 🛠️ Rebuild Frontend After Changes

```bash
cd client
npm install
npm run build
# → Output goes to server/public/ (served automatically)
```

---

## 📜 License
MIT — Free to use and modify.
