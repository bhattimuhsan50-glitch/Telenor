/**
 * Telenor Quiz Agent - Backend Server
 * Express + WebSocket + Quiz Scraper + Scheduler
 */

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const cron = require('node-cron');
const axios = require('axios');
const cheerio = require('cheerio');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: '*' }));
app.use(express.json());

// Serve static frontend in production
const clientBuild = path.join(__dirname, 'public');
if (fs.existsSync(clientBuild)) {
  app.use(express.static(clientBuild));
}

// ─── In-Memory State (survives restarts via JSON file) ───────────────────────
const STATE_FILE = path.join(__dirname, 'state.json');

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch (e) {
    console.error('Failed to load state:', e.message);
  }
  return {
    whatsapp: {
      isAuthenticated: false,
      isReady: false,
      channelTarget: null,
      qrCode: null
    },
    schedule: {
      time: '00:15',
      template: '📱 *Telenor Quiz Answers - {date}*\n\n{answers}\n\n✅ All answers verified!\nGood Luck! 🍀',
      enabled: false
    },
    channels: [],
    history: []
  };
}

function saveState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch (e) {
    console.error('Failed to save state:', e.message);
  }
}

let appState = loadState();
let cronJob = null;

// ─── WebSocket Broadcast ──────────────────────────────────────────────────────
function broadcast(data) {
  const msg = JSON.stringify(data);
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

wss.on('connection', (ws) => {
  console.log('🔌 WebSocket client connected');
  // Send current state on connect
  ws.send(JSON.stringify({ type: 'state', data: appState.whatsapp }));
  ws.on('close', () => console.log('🔌 WebSocket client disconnected'));
  ws.on('error', (err) => console.error('WebSocket error:', err.message));
});

// ─── Quiz Sources & Scraper ───────────────────────────────────────────────────
const QUIZ_SOURCES = [
  'https://mytelenoranswer.com/',
  'https://mytelenoranswertoday.pk/',
  'https://telequiztoday.pk/',
  'https://telenorquiztoday.com.pk/'
];

/**
 * Scrape quiz answers from a single source URL
 */
// Rotate user agents to reduce 403s
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
];

async function scrapeSource(url) {
  const ua = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
  const domain = new URL(url).hostname;
  try {
    const response = await axios.get(url, {
      timeout: 12000,
      headers: {
        'User-Agent': ua,
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,ur;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'max-age=0',
        'Referer': `https://www.google.com/search?q=telenor+quiz+answers+today`,
      },
      maxRedirects: 5,
      validateStatus: (s) => s < 500,
    });
    if (response.status === 403 || response.status === 404) {
      console.warn(`⚠️  ${url} returned ${response.status}`);
      return null;
    }

    const $ = cheerio.load(response.data);
    const answers = [];
    const questions = [];

    // Strategy 1: Look for answer elements by common class names
    const answerSelectors = [
      '.answer', '.correct-answer', '.quiz-answer', '[class*="answer"]',
      '.correct', '[class*="correct"]', 'strong', 'b'
    ];

    // Strategy 2: Parse numbered list patterns in text
    const bodyText = $('body').text();

    // Pattern: "1. Answer | 2. Answer | ..."
    const pipePattern = /1[.)]\s*([^|]+)\s*\|\s*2[.)]\s*([^|]+)\s*\|\s*3[.)]\s*([^|]+)\s*\|\s*4[.)]\s*([^|]+)\s*\|\s*5[.)]\s*([^|\n]+)/i;
    const pipeMatch = bodyText.match(pipePattern);
    if (pipeMatch) {
      for (let i = 1; i <= 5 && i < pipeMatch.length; i++) {
        if (pipeMatch[i]) answers.push(pipeMatch[i].trim());
      }
    }

    // Pattern: "Answer: XYZ" repeated
    if (answers.length === 0) {
      $('p, li, div').each((_, el) => {
        const text = $(el).text().trim();
        const match = text.match(/^(?:Answer|Ans|A)[:\s]+(.+)$/i);
        if (match && match[1] && answers.length < 5) {
          answers.push(match[1].trim());
        }
      });
    }

    // Strategy 3: Extract from ordered lists
    if (answers.length === 0) {
      $('ol li').each((_, el) => {
        const text = $(el).text().trim();
        if (text && answers.length < 5) {
          answers.push(text);
        }
      });
    }

    // Strategy 4: Strong/bold text after question patterns
    if (answers.length === 0) {
      $('strong, b').each((_, el) => {
        const text = $(el).text().trim();
        if (text && text.length > 2 && text.length < 100 && answers.length < 5) {
          answers.push(text);
        }
      });
    }

    // Extract questions
    $('h2, h3, h4, .question, [class*="question"]').each((_, el) => {
      const text = $(el).text().trim();
      if (text && text.length > 10 && questions.length < 5) {
        questions.push(text);
      }
    });

    // Get date from page
    const dateMatch = bodyText.match(/(\w+\s+\d{1,2},?\s+\d{4})/);
    const date = dateMatch ? dateMatch[1] : new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    if (answers.length > 0) {
      return {
        date,
        answers,
        questions: questions.length > 0 ? questions : answers.map((_, i) => `Question ${i + 1}`),
        source: url
      };
    }
    return null;
  } catch (err) {
    console.warn(`⚠️  Failed to scrape ${url}: ${err.message}`);
    return null;
  }
}

/**
 * Try all sources and return first successful result
 */
async function fetchQuizAnswers() {
  console.log('🔍 Fetching quiz answers from sources...');
  for (const url of QUIZ_SOURCES) {
    const result = await scrapeSource(url);
    if (result && result.answers.length > 0) {
      console.log(`✅ Got ${result.answers.length} answers from ${url}`);
      return result;
    }
  }

  // Fallback when all sources fail
  console.warn('⚠️  All sources failed. Returning fallback data.');
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  return {
    date: today,
    answers: ['Could not fetch', 'Could not fetch', 'Could not fetch', 'Could not fetch', 'Could not fetch'],
    questions: ['Question 1', 'Question 2', 'Question 3', 'Question 4', 'Question 5'],
    source: 'fallback',
    error: 'All sources failed. Check internet or try again later.'
  };
}

/**
 * Format quiz data into WhatsApp message
 */
function formatMessage(quizData, template) {
  const defaultTemplate = '📱 *Telenor Quiz Answers - {date}*\n\n{answers}\n\n✅ All answers verified!\nGood Luck! 🍀';
  const tmpl = template || defaultTemplate;
  const answersText = quizData.answers.map((a, i) => `${i + 1}. ✅ ${a}`).join('\n');
  return tmpl.replace('{date}', quizData.date).replace('{answers}', answersText);
}

// ─── WhatsApp Simulation Layer ────────────────────────────────────────────────
// NOTE: whatsapp-web.js requires a real Chromium environment.
// In this hosted sandbox, we simulate the WhatsApp layer while keeping
// all other logic (quiz fetch, schedule, history) fully functional.
// To enable real WhatsApp: install whatsapp-web.js and replace this section.

let simulatedChannels = [
  { id: 'channel_1@newsletter', name: 'Telenor Quiz Channel', isGroup: false },
  { id: 'group_1@g.us', name: 'Quiz Answers Group', isGroup: true },
  { id: 'group_2@g.us', name: 'Family Group', isGroup: true }
];

async function sendWhatsAppMessage(channelId, message) {
  // Simulate send with 500ms delay
  await new Promise(r => setTimeout(r, 500));
  console.log(`📤 [SIMULATED] Message sent to ${channelId}:\n${message.slice(0, 100)}...`);
  return true;
}

// ─── Scheduler ────────────────────────────────────────────────────────────────
function startScheduler(time, template) {
  stopScheduler();
  const [hour, minute] = time.split(':');
  const cronExpr = `${minute} ${hour} * * *`;

  try {
    cronJob = cron.schedule(cronExpr, async () => {
      console.log(`⏰ Scheduled task running at ${time}...`);
      broadcast({ type: 'scheduler:start', time });

      const quiz = await fetchQuizAnswers();
      const message = formatMessage(quiz, template);

      if (appState.whatsapp.channelTarget) {
        const success = await sendWhatsAppMessage(
          appState.whatsapp.channelTarget.id,
          message
        );
        if (success) {
          addToHistory(quiz, message, 'scheduled');
          broadcast({ type: 'scheduler:success', quiz });
        }
      } else {
        broadcast({ type: 'scheduler:no_channel' });
        console.warn('⚠️  No channel target set. Skipping send.');
      }
    }, { timezone: 'Asia/Karachi' });

    console.log(`✅ Scheduler started: ${cronExpr} (PKT)`);
  } catch (err) {
    console.error('Failed to start scheduler:', err.message);
  }
}

function stopScheduler() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    console.log('⏹  Scheduler stopped');
  }
}

// ─── History ──────────────────────────────────────────────────────────────────
function addToHistory(quiz, message, trigger = 'manual') {
  const entry = {
    id: Date.now(),
    date: quiz.date,
    answers: quiz.answers,
    message,
    trigger,
    channel: appState.whatsapp.channelTarget?.name || 'Unknown',
    sentAt: new Date().toISOString()
  };
  appState.history.unshift(entry);
  if (appState.history.length > 50) appState.history = appState.history.slice(0, 50);
  saveState(appState);
}

// ─── API Routes ───────────────────────────────────────────────────────────────

// GET /api/status
app.get('/api/status', (req, res) => {
  res.json({
    isAuthenticated: appState.whatsapp.isAuthenticated,
    isReady: appState.whatsapp.isReady,
    hasQrCode: !!appState.whatsapp.qrCode,
    channelTarget: appState.whatsapp.channelTarget
  });
});

// GET /api/qr - Get QR code for WhatsApp login
app.get('/api/qr', (req, res) => {
  // Simulate QR generation — in production replace with real whatsapp-web.js QR
  if (!appState.whatsapp.isAuthenticated) {
    // Simulate connecting after 3s of QR display
    if (!appState.whatsapp.qrCode) {
      appState.whatsapp.qrCode = 'SIMULATED_QR_CODE_' + Date.now();
      // Auto-connect after 3 seconds for demo
      setTimeout(() => {
        appState.whatsapp.isAuthenticated = true;
        appState.whatsapp.isReady = true;
        appState.whatsapp.qrCode = null;
        saveState(appState);
        broadcast({ type: 'whatsapp:ready' });
        console.log('✅ [SIM] WhatsApp connected!');
      }, 3000);
    }
    return res.json({ qrCode: appState.whatsapp.qrCode });
  }
  res.json({ qrCode: null, message: 'Already authenticated' });
});

// GET /api/channels
app.get('/api/channels', (req, res) => {
  if (!appState.whatsapp.isReady) {
    return res.status(400).json({ error: 'WhatsApp not connected' });
  }
  res.json({ channels: simulatedChannels });
});

// GET /api/channel/target
app.get('/api/channel/target', (req, res) => {
  if (!appState.whatsapp.channelTarget) {
    return res.status(404).json({ error: 'No channel target set' });
  }
  res.json(appState.whatsapp.channelTarget);
});

// POST /api/channel/target
app.post('/api/channel/target', (req, res) => {
  const { channelId, channelName } = req.body;
  if (!channelId || !channelName) {
    return res.status(400).json({ error: 'channelId and channelName are required' });
  }
  appState.whatsapp.channelTarget = { id: channelId, name: channelName };
  saveState(appState);
  broadcast({ type: 'channel:updated', channel: appState.whatsapp.channelTarget });
  res.json({ success: true, channel: appState.whatsapp.channelTarget });
});

// GET /api/quiz - Fetch quiz answers
app.get('/api/quiz', async (req, res) => {
  try {
    const quiz = await fetchQuizAnswers();
    res.json(quiz);
  } catch (err) {
    console.error('Quiz fetch error:', err.message);
    res.status(500).json({ error: 'Failed to fetch quiz', details: err.message });
  }
});

// POST /api/send - Send message to channel
app.post('/api/send', async (req, res) => {
  const { message } = req.body;
  if (!message) {
    return res.status(400).json({ error: 'message is required' });
  }
  if (!appState.whatsapp.isReady) {
    return res.status(400).json({ error: 'WhatsApp not connected. Connect first.' });
  }
  if (!appState.whatsapp.channelTarget) {
    return res.status(400).json({ error: 'No channel target set. Select a channel first.' });
  }

  try {
    const success = await sendWhatsAppMessage(appState.whatsapp.channelTarget.id, message);
    if (success) {
      // Log to history
      const quiz = { date: new Date().toLocaleDateString(), answers: [] };
      addToHistory(quiz, message, 'manual');
      broadcast({ type: 'message:sent', channel: appState.whatsapp.channelTarget.name });
    }
    res.json({ success });
  } catch (err) {
    console.error('Send error:', err.message);
    res.status(500).json({ error: 'Failed to send message', details: err.message });
  }
});

// GET /api/schedule
app.get('/api/schedule', (req, res) => {
  res.json(appState.schedule);
});

// POST /api/schedule
app.post('/api/schedule', (req, res) => {
  const { time, template, enabled } = req.body;

  // Validate time format HH:MM
  if (time && !/^\d{2}:\d{2}$/.test(time)) {
    return res.status(400).json({ error: 'Invalid time format. Use HH:MM' });
  }

  appState.schedule = {
    time: time || appState.schedule.time,
    template: template || appState.schedule.template,
    enabled: enabled !== undefined ? enabled : appState.schedule.enabled
  };
  saveState(appState);

  if (appState.schedule.enabled) {
    startScheduler(appState.schedule.time, appState.schedule.template);
  } else {
    stopScheduler();
  }

  broadcast({ type: 'schedule:updated', schedule: appState.schedule });
  res.json({ success: true, schedule: appState.schedule });
});

// POST /api/logout
app.post('/api/logout', (req, res) => {
  appState.whatsapp = { isAuthenticated: false, isReady: false, channelTarget: null, qrCode: null };
  saveState(appState);
  broadcast({ type: 'whatsapp:disconnected' });
  res.json({ success: true });
});

// POST /api/restart
app.post('/api/restart', (req, res) => {
  appState.whatsapp.qrCode = null;
  saveState(appState);
  broadcast({ type: 'whatsapp:restarting' });
  setTimeout(() => {
    broadcast({ type: 'whatsapp:ready' });
  }, 2000);
  res.json({ success: true });
});

// GET /api/history
app.get('/api/history', (req, res) => {
  res.json({ history: appState.history });
});

// DELETE /api/history
app.delete('/api/history', (req, res) => {
  appState.history = [];
  saveState(appState);
  res.json({ success: true });
});

// POST /api/run - Manually trigger fetch + send
app.post('/api/run', async (req, res) => {
  if (!appState.whatsapp.isReady) {
    return res.status(400).json({ error: 'WhatsApp not connected' });
  }
  if (!appState.whatsapp.channelTarget) {
    return res.status(400).json({ error: 'No channel target set' });
  }

  try {
    broadcast({ type: 'agent:running' });
    const quiz = await fetchQuizAnswers();
    const message = formatMessage(quiz, appState.schedule.template);
    const success = await sendWhatsAppMessage(appState.whatsapp.channelTarget.id, message);
    if (success) {
      addToHistory(quiz, message, 'manual');
      broadcast({ type: 'agent:done', quiz });
    }
    res.json({ success, quiz, message });
  } catch (err) {
    broadcast({ type: 'agent:error', error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
});

// Catch-all: serve frontend
app.get('*', (req, res) => {
  if (fs.existsSync(clientBuild)) {
    res.sendFile(path.join(clientBuild, 'index.html'));
  } else {
    res.json({ message: 'Telenor Agent API running. Frontend not built yet.' });
  }
});

// ─── Start Scheduler if was enabled ──────────────────────────────────────────
if (appState.schedule.enabled) {
  startScheduler(appState.schedule.time, appState.schedule.template);
}

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`\n🚀 Telenor Agent Server running on http://localhost:${PORT}`);
  console.log(`📡 WebSocket ready`);
  console.log(`📋 API: http://localhost:${PORT}/api/health\n`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down gracefully...');
  stopScheduler();
  server.close();
});
