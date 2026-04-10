import { useState, useEffect, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Switch } from '@/components/ui/switch';
import { Toaster, toast } from 'sonner';
import {
  Search,
  Send,
  Clock,
  MessageCircle,
  Settings,
  Play,
  StopCircle,
  CheckCircle2,
  RefreshCw,
  Radio,
  Calendar,
  Copy,
  QrCode,
  LogOut,
  Smartphone,
  AlertCircle,
  History,
  Wifi,
  WifiOff,
  Zap,
} from 'lucide-react';
import { fetchTodaysQuiz, formatQuizForWhatsApp, type QuizData } from './utils/quizFetcher';
import {
  getWhatsAppStatus,
  getChannels,
  setChannelTarget,
  getChannelTarget,
  sendToWhatsAppChannel,
  scheduleTask,
  getSchedule,
  logoutWhatsApp,
  restartWhatsApp,
  copyToClipboard,
  createWebSocketConnection,
  runAgentNow,
  getHistory,
} from './utils/whatsapp';
import { saveToStorage, loadFromStorage } from './utils/storage';
import './App.css';

// ─── Types ────────────────────────────────────────────────────────────────────
interface HistoryEntry {
  id: number;
  date: string;
  answers: string[];
  message: string;
  trigger: string;
  channel: string;
  sentAt: string;
}

// ─── App ──────────────────────────────────────────────────────────────────────
function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [isSearching, setIsSearching] = useState(false);
  const [quizData, setQuizData] = useState<QuizData | null>(null);
  const [formattedMessage, setFormattedMessage] = useState('');
  const [scheduleTime, setScheduleTime] = useState('00:15');
  const [isScheduled, setIsScheduled] = useState(false);
  const [isAgentRunning, setIsAgentRunning] = useState(false);
  const [messageTemplate, setMessageTemplate] = useState(
    `📱 *Telenor Quiz Answers - {date}*\n\n{answers}\n\n✅ All answers verified!\nGood Luck! 🍀`
  );
  const [lastFetchTime, setLastFetchTime] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [wsConnected, setWsConnected] = useState(false);

  // WhatsApp state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [channels, setChannels] = useState<Array<{ id: string; name: string; isGroup: boolean }>>([]);
  const [selectedChannel, setSelectedChannel] = useState<string>('');
  const [channelTarget, setChannelTargetState] = useState<{ id: string; name: string } | null>(null);
  const [showQrModal, setShowQrModal] = useState(false);

  // Use ref so WebSocket handlers always see latest state
  const wsRef = useRef<WebSocket | null>(null);

  // ─── Init ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    // Restore local config
    const saved = loadFromStorage<{ scheduleTime: string; messageTemplate: string; isScheduled: boolean }>('telenorAgentConfig');
    if (saved) {
      if (saved.scheduleTime) setScheduleTime(saved.scheduleTime);
      if (saved.messageTemplate) setMessageTemplate(saved.messageTemplate);
    }
    const lastFetch = loadFromStorage<string>('lastFetchTime');
    if (lastFetch) setLastFetchTime(lastFetch);

    loadStatus();
    loadSchedule();
    loadChannelTarget();
    loadHistory();
  }, []);

  // Save config on change
  useEffect(() => {
    saveToStorage('telenorAgentConfig', { scheduleTime, messageTemplate, isScheduled });
  }, [scheduleTime, messageTemplate, isScheduled]);

  // ─── WebSocket ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const ws = createWebSocketConnection((data) => {
      setWsConnected(true);
      switch (data.type) {
        case 'state':
          setIsAuthenticated(data.data?.isAuthenticated ?? false);
          setIsReady(data.data?.isReady ?? false);
          if (data.data?.channelTarget) setChannelTargetState(data.data.channelTarget);
          break;
        case 'whatsapp:ready':
          setIsAuthenticated(true);
          setIsReady(true);
          setShowQrModal(false);
          setQrCode(null);
          toast.success('✅ WhatsApp connected and ready!');
          loadChannels();
          break;
        case 'whatsapp:disconnected':
          setIsAuthenticated(false);
          setIsReady(false);
          toast.error('WhatsApp disconnected');
          break;
        case 'whatsapp:restarting':
          setIsReady(false);
          toast.info('Restarting WhatsApp...');
          break;
        case 'channel:updated':
          setChannelTargetState(data.channel);
          break;
        case 'schedule:updated':
          setIsScheduled(data.schedule?.enabled ?? false);
          break;
        case 'agent:running':
          setIsAgentRunning(true);
          break;
        case 'agent:done':
          setIsAgentRunning(false);
          toast.success('Agent completed: quiz sent!');
          loadHistory();
          break;
        case 'agent:error':
          setIsAgentRunning(false);
          toast.error(`Agent error: ${data.error}`);
          break;
        case 'message:sent':
          toast.success(`📤 Message sent to ${data.channel}`);
          loadHistory();
          break;
        case 'scheduler:success':
          toast.success('⏰ Scheduled task completed!');
          loadHistory();
          break;
        case 'scheduler:no_channel':
          toast.warning('Scheduled task ran but no channel is set!');
          break;
      }
    });
    wsRef.current = ws;

    return () => {
      ws.close();
      setWsConnected(false);
    };
  }, []);

  // ─── Data loaders ───────────────────────────────────────────────────────────
  const loadStatus = async () => {
    try {
      const status = await getWhatsAppStatus();
      setIsAuthenticated(status.isAuthenticated);
      setIsReady(status.isReady);
      if (status.channelTarget) {
        setChannelTargetState(status.channelTarget);
        setSelectedChannel(status.channelTarget.id);
      }
    } catch {
      // Backend may not be up yet — silent fail
    }
  };

  const loadSchedule = async () => {
    try {
      const schedule = await getSchedule();
      if (schedule.time) setScheduleTime(schedule.time);
      if (schedule.enabled !== undefined) setIsScheduled(schedule.enabled);
      if (schedule.template) setMessageTemplate(schedule.template);
    } catch {}
  };

  const loadChannelTarget = async () => {
    try {
      const target = await getChannelTarget();
      if (target) {
        setChannelTargetState(target);
        setSelectedChannel(target.id);
      }
    } catch {}
  };

  const loadChannels = useCallback(async () => {
    try {
      const list = await getChannels();
      setChannels(list);
    } catch (err: any) {
      toast.error('Could not load channels: ' + err.message);
    }
  }, []);

  const loadHistory = async () => {
    try {
      const data = await getHistory();
      setHistory(data.history || []);
    } catch {}
  };

  // ─── Actions ─────────────────────────────────────────────────────────────────
  const fetchQuizAnswers = useCallback(async () => {
    setIsSearching(true);
    toast.info('🔍 Fetching Telenor quiz answers...');
    try {
      const data = await fetchTodaysQuiz();
      if (data && data.answers.length > 0) {
        setQuizData(data);
        const formatted = formatQuizForWhatsApp(data, messageTemplate);
        setFormattedMessage(formatted);
        const now = new Date().toLocaleString();
        setLastFetchTime(now);
        saveToStorage('lastFetchTime', now);
        toast.success(`✅ Found ${data.answers.length} answers for ${data.date}!`);
        if (data.error) toast.warning(`⚠️ ${data.error}`);
      } else {
        toast.error('No answers found. Sources may be down — try again later.');
      }
    } catch (err: any) {
      toast.error('Failed to fetch: ' + (err.message || 'Unknown error'));
    } finally {
      setIsSearching(false);
    }
  }, [messageTemplate]);

  const handleSendToChannel = useCallback(async (msgOverride?: string) => {
    const msg = msgOverride || formattedMessage;
    if (!isReady) {
      toast.error('WhatsApp not connected. Go to Settings → Connect.');
      setActiveTab('settings');
      return;
    }
    if (!channelTarget) {
      toast.error('No channel selected. Go to Settings → Channel.');
      setActiveTab('settings');
      return;
    }
    if (!msg) {
      toast.error('No message to send. Fetch quiz answers first.');
      return;
    }
    try {
      await sendToWhatsAppChannel(msg);
      toast.success(`📤 Message sent to ${channelTarget.name}!`);
      loadHistory();
    } catch (err: any) {
      toast.error('Send failed: ' + err.message);
    }
  }, [isReady, channelTarget, formattedMessage]);

  // BUG FIX: was using stale quizData ref — now uses local variable
  const handleAutoSearchAndSend = async () => {
    setIsAgentRunning(true);
    try {
      const result = await runAgentNow();
      if (result.success) {
        setQuizData(result.quiz);
        setFormattedMessage(result.message);
        toast.success('🚀 Agent: quiz fetched and sent!');
        loadHistory();
      }
    } catch (err: any) {
      toast.error('Agent failed: ' + err.message);
    } finally {
      setIsAgentRunning(false);
    }
  };

  const handleConnectWhatsApp = async () => {
    setShowQrModal(true);
    try {
      const qr = await fetch('/api/qr').then(r => r.json());
      if (qr.qrCode) {
        setQrCode(qr.qrCode);
      } else if (qr.message) {
        toast.info(qr.message);
        setShowQrModal(false);
        loadStatus();
      }
    } catch {
      toast.error('Could not get QR code — is the server running?');
      setShowQrModal(false);
    }
  };

  const handleSetChannel = async () => {
    if (!selectedChannel) { toast.error('Select a channel first'); return; }
    const ch = channels.find(c => c.id === selectedChannel);
    if (!ch) { toast.error('Channel not found'); return; }
    try {
      await setChannelTarget(ch.id, ch.name);
      setChannelTargetState({ id: ch.id, name: ch.name });
      toast.success(`✅ Target set: ${ch.name}`);
    } catch (err: any) {
      toast.error('Failed: ' + err.message);
    }
  };

  const toggleScheduler = async () => {
    const newState = !isScheduled;
    setIsScheduled(newState); // optimistic
    try {
      await scheduleTask(scheduleTime, messageTemplate, newState);
      toast.success(newState ? `⏰ Scheduler ON — daily at ${scheduleTime} PKT` : '⏹ Scheduler OFF');
    } catch (err: any) {
      setIsScheduled(!newState); // revert on error
      toast.error('Schedule update failed: ' + err.message);
    }
  };

  const handleLogout = async () => {
    try {
      await logoutWhatsApp();
      setIsAuthenticated(false);
      setIsReady(false);
      setChannelTargetState(null);
      toast.success('Logged out');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleRestart = async () => {
    try {
      await restartWhatsApp();
      setIsReady(false);
      toast.info('Restarting...');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const refreshChannels = async () => {
    if (!isReady) { toast.error('Connect WhatsApp first'); return; }
    toast.info('Loading channels...');
    await loadChannels();
    toast.success('Channels refreshed!');
  };

  const handleCopyMessage = async () => {
    if (!formattedMessage) { toast.error('Fetch answers first'); return; }
    await copyToClipboard(formattedMessage);
    toast.success('📋 Copied to clipboard!');
  };

  // ─── Derived ────────────────────────────────────────────────────────────────
  const statusColor = isReady ? 'bg-green-500' : isAuthenticated ? 'bg-yellow-500' : 'bg-red-500';
  const statusLabel = isReady ? 'Connected & Ready' : isAuthenticated ? 'Authenticating…' : 'Not Connected';

  // ─── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-4 md:p-8">
      <Toaster position="top-right" richColors />
      <div className="max-w-5xl mx-auto">

        {/* Header */}
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-bold text-indigo-900 mb-1">📱 Telenor Quiz Agent</h1>
          <p className="text-gray-600 text-sm">Auto-fetches daily quiz answers & sends to your WhatsApp channel</p>
        </div>

        {/* Status Bar */}
        <Card className="mb-4 border-l-4 border-l-indigo-500">
          <CardContent className="py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className={`w-3 h-3 rounded-full ${statusColor} ${isReady ? 'animate-pulse' : ''}`} />
                <span className="font-medium text-sm">WhatsApp: {statusLabel}</span>
                <span className={`text-xs px-2 py-0.5 rounded-full ${wsConnected ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {wsConnected ? <span className="flex items-center gap-1"><Wifi className="w-3 h-3" /> Live</span> : <span className="flex items-center gap-1"><WifiOff className="w-3 h-3" /> Offline</span>}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-xs text-gray-500">
                {channelTarget && <span className="flex items-center gap-1"><Radio className="w-3 h-3" /> {channelTarget.name}</span>}
                {lastFetchTime && <span>Last fetch: {lastFetchTime}</span>}
                <span className="flex items-center gap-1"><Clock className="w-3 h-3" /> Daily {scheduleTime}</span>
                {isScheduled && <span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">Scheduler ON</span>}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* QR Modal */}
        {showQrModal && (
          <Card className="mb-4 border-2 border-indigo-400 bg-indigo-50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-indigo-900">
                <QrCode className="w-5 h-5" /> Scan QR Code to Connect WhatsApp
              </CardTitle>
              <CardDescription>Open WhatsApp → Settings → Linked Devices → Link a Device</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-4">
              {qrCode ? (
                <>
                  {/* In demo mode: QR is a text token, show instructions */}
                  <div className="w-56 h-56 bg-white border-2 border-gray-300 rounded-lg flex items-center justify-center">
                    <div className="text-center p-4">
                      <QrCode className="w-16 h-16 text-gray-400 mx-auto mb-2" />
                      <p className="text-xs text-gray-500">QR appears here in production with whatsapp-web.js</p>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 text-center max-w-xs">
                    In demo mode, WhatsApp auto-connects after 3 seconds. In production, install whatsapp-web.js to show real QR.
                  </p>
                </>
              ) : (
                <div className="flex items-center gap-2 text-gray-500">
                  <RefreshCw className="w-4 h-4 animate-spin" /> Generating QR code...
                </div>
              )}
              <Button variant="outline" onClick={() => setShowQrModal(false)}>Close</Button>
            </CardContent>
          </Card>
        )}

        {/* Not Connected Banner */}
        {!isReady && !showQrModal && (
          <Card className="mb-4 border-2 border-yellow-400 bg-yellow-50">
            <CardContent className="py-3">
              <div className="flex items-center gap-3">
                <AlertCircle className="w-5 h-5 text-yellow-600 shrink-0" />
                <div className="flex-1">
                  <p className="font-medium text-yellow-800 text-sm">WhatsApp Not Connected</p>
                  <p className="text-xs text-yellow-700">Connect to enable automatic message sending</p>
                </div>
                <Button size="sm" onClick={handleConnectWhatsApp}>
                  <QrCode className="w-4 h-4 mr-1" /> Connect
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Main Tabs */}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="dashboard"><Search className="w-4 h-4 mr-1" />Dashboard</TabsTrigger>
            <TabsTrigger value="settings"><Settings className="w-4 h-4 mr-1" />Settings</TabsTrigger>
            <TabsTrigger value="history"><History className="w-4 h-4 mr-1" />History</TabsTrigger>
          </TabsList>

          {/* ── Dashboard ── */}
          <TabsContent value="dashboard" className="space-y-4">

            {/* Fetch */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><Search className="w-4 h-4" />Fetch Quiz Answers</CardTitle>
                <CardDescription>Scrapes from 4 verified Telenor quiz sources (server-side, no CORS issues)</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col sm:flex-row gap-3">
                <div className="flex-1 text-xs text-gray-500 flex items-center">
                  Sources: mytelenoranswer.com · mytelenoranswertoday.pk · telequiztoday.pk · telenorquiztoday.com.pk
                </div>
                <Button onClick={fetchQuizAnswers} disabled={isSearching} className="shrink-0">
                  {isSearching ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
                  {isSearching ? 'Fetching…' : 'Fetch Answers'}
                </Button>
              </CardContent>
            </Card>

            {/* Results */}
            {quizData && quizData.answers.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                    Answers — {quizData.date}
                    {quizData.source && <span className="text-xs font-normal text-gray-400 ml-1">via {quizData.source}</span>}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {quizData.answers.map((answer, i) => (
                      <div key={i} className="p-3 bg-green-50 rounded-lg border border-green-200">
                        <div className="text-xs text-gray-500 mb-1">Question {i + 1}</div>
                        <div className="text-green-700 font-semibold text-sm">✅ {answer}</div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Message Preview */}
            {formattedMessage && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base"><MessageCircle className="w-4 h-4" />Message Preview</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="p-4 bg-green-50 rounded-lg border border-green-200 whitespace-pre-wrap font-mono text-sm">
                    {formattedMessage}
                  </div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Button onClick={() => handleSendToChannel()} disabled={!isReady} className="bg-green-600 hover:bg-green-700 flex-1">
                      <Send className="w-4 h-4 mr-2" /> Send to Channel
                    </Button>
                    <Button variant="outline" onClick={handleCopyMessage} className="flex-1">
                      <Copy className="w-4 h-4 mr-2" /> Copy Message
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Quick Actions */}
            <Card>
              <CardHeader><CardTitle className="text-base">⚡ Quick Actions</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Button
                  variant="outline"
                  onClick={handleAutoSearchAndSend}
                  disabled={isAgentRunning || !isReady}
                  className="h-auto py-4"
                >
                  {isAgentRunning ? <RefreshCw className="w-5 h-5 mr-2 animate-spin" /> : <Zap className="w-5 h-5 mr-2" />}
                  <div className="text-left">
                    <div className="font-semibold">{isAgentRunning ? 'Running…' : 'Run Agent Now'}</div>
                    <div className="text-xs text-gray-500">Fetch & send in one click</div>
                  </div>
                </Button>
                <Button
                  variant={isScheduled ? 'default' : 'outline'}
                  onClick={toggleScheduler}
                  disabled={!isReady}
                  className={`h-auto py-4 ${isScheduled ? 'bg-indigo-600 hover:bg-indigo-700' : ''}`}
                >
                  {isScheduled ? <StopCircle className="w-5 h-5 mr-2" /> : <Calendar className="w-5 h-5 mr-2" />}
                  <div className="text-left">
                    <div className="font-semibold">{isScheduled ? 'Stop Scheduler' : 'Start Scheduler'}</div>
                    <div className="text-xs opacity-70">{isScheduled ? `Runs daily at ${scheduleTime} PKT` : 'Enable auto-send'}</div>
                  </div>
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Settings ── */}
          <TabsContent value="settings" className="space-y-4">

            {/* WhatsApp Connection */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><Smartphone className="w-4 h-4" />WhatsApp Connection</CardTitle>
                <CardDescription>Connect your WhatsApp account to send messages automatically</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <div className={`w-3 h-3 rounded-full ${statusColor}`} />
                    <div>
                      <div className="font-medium text-sm">{statusLabel}</div>
                      <div className="text-xs text-gray-500">{isReady ? 'Ready to send messages' : 'Scan QR code to connect'}</div>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {!isReady && (
                      <Button size="sm" onClick={handleConnectWhatsApp}>
                        <QrCode className="w-4 h-4 mr-1" /> Connect
                      </Button>
                    )}
                    {isReady && (
                      <>
                        <Button size="sm" variant="outline" onClick={handleRestart}>
                          <RefreshCw className="w-4 h-4 mr-1" /> Restart
                        </Button>
                        <Button size="sm" variant="destructive" onClick={handleLogout}>
                          <LogOut className="w-4 h-4 mr-1" /> Logout
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Channel Selection */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><Radio className="w-4 h-4" />Target Channel</CardTitle>
                <CardDescription>Select which WhatsApp group or channel receives the answers</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {!isReady ? (
                  <div className="p-4 bg-yellow-50 rounded-lg text-center text-sm text-yellow-800">
                    Connect WhatsApp first to load channels
                  </div>
                ) : (
                  <>
                    <div className="flex gap-2">
                      <select
                        value={selectedChannel}
                        onChange={(e) => setSelectedChannel(e.target.value)}
                        className="flex-1 p-2 border border-gray-300 rounded-md text-sm"
                      >
                        <option value="">Select a channel…</option>
                        {channels.map((ch) => (
                          <option key={ch.id} value={ch.id}>
                            {ch.name} {ch.isGroup ? '(Group)' : '(Channel)'}
                          </option>
                        ))}
                      </select>
                      <Button size="sm" variant="outline" onClick={refreshChannels}>
                        <RefreshCw className="w-4 h-4" />
                      </Button>
                    </div>
                    <Button onClick={handleSetChannel} disabled={!selectedChannel} className="w-full">
                      <CheckCircle2 className="w-4 h-4 mr-2" /> Set as Target
                    </Button>
                    {channelTarget && (
                      <div className="p-3 bg-green-50 rounded-lg border border-green-200 text-sm text-green-800 font-medium">
                        ✅ Current Target: {channelTarget.name}
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            {/* Schedule */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><Clock className="w-4 h-4" />Schedule Settings</CardTitle>
                <CardDescription>Set when the bot auto-fetches and sends quiz answers</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="scheduleTime">Daily Send Time (Pakistan Standard Time)</Label>
                  <Input
                    id="scheduleTime"
                    type="time"
                    value={scheduleTime}
                    onChange={(e) => setScheduleTime(e.target.value)}
                    className="max-w-xs mt-1"
                  />
                  <p className="text-xs text-gray-500 mt-1">Recommended: 00:15 — answers update after midnight</p>
                </div>
                <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                  <div>
                    <div className="font-medium text-sm">Enable Daily Automation</div>
                    <div className="text-xs text-gray-500">Runs the agent automatically at the time above</div>
                  </div>
                  <Switch checked={isScheduled} onCheckedChange={toggleScheduler} disabled={!isReady} />
                </div>
              </CardContent>
            </Card>

            {/* Message Template */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base"><MessageCircle className="w-4 h-4" />Message Template</CardTitle>
                <CardDescription>Customize the WhatsApp message format</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2">
                <textarea
                  className="w-full min-h-[140px] p-3 border border-gray-300 rounded-md font-mono text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  value={messageTemplate}
                  onChange={(e) => setMessageTemplate(e.target.value)}
                />
                <p className="text-xs text-gray-500">Variables: <code className="bg-gray-100 px-1 rounded">{'{date}'}</code> · <code className="bg-gray-100 px-1 rounded">{'{answers}'}</code></p>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    if (quizData) {
                      setFormattedMessage(formatQuizForWhatsApp(quizData, messageTemplate));
                      toast.success('Preview updated');
                    } else {
                      toast.info('Fetch answers first to preview');
                    }
                  }}
                >
                  Preview Template
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── History ── */}
          <TabsContent value="history">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base justify-between">
                  <span className="flex items-center gap-2"><History className="w-4 h-4" />Send History</span>
                  {history.length > 0 && (
                    <Button size="sm" variant="outline" onClick={loadHistory}>
                      <RefreshCw className="w-3 h-3 mr-1" /> Refresh
                    </Button>
                  )}
                </CardTitle>
                <CardDescription>All messages sent by the agent (latest 50)</CardDescription>
              </CardHeader>
              <CardContent>
                {history.length === 0 ? (
                  <div className="text-center py-12 text-gray-400">
                    <Clock className="w-10 h-10 mx-auto mb-3 opacity-40" />
                    <p className="text-sm">No messages sent yet</p>
                    <p className="text-xs mt-1">Run the agent or send manually to see history here</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {history.map((entry) => (
                      <div key={entry.id} className="p-4 border border-gray-200 rounded-lg bg-white">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <span className="font-medium text-sm">{entry.date}</span>
                            <span className="ml-2 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{entry.trigger}</span>
                          </div>
                          <span className="text-xs text-gray-400">{new Date(entry.sentAt).toLocaleString()}</span>
                        </div>
                        <div className="text-xs text-gray-500 mb-2">→ {entry.channel}</div>
                        {entry.answers.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {entry.answers.map((a, i) => (
                              <span key={i} className="text-xs bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded">
                                {i + 1}. {a}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Footer */}
        <div className="mt-8 text-center text-xs text-gray-400">
          <p>Telenor Quiz Agent v2.0 — Built with Express + React + shadcn/ui</p>
          <p className="mt-1">
            Sources: mytelenoranswer.com · mytelenoranswertoday.pk · telequiztoday.pk · telenorquiztoday.com.pk
          </p>
        </div>
      </div>
    </div>
  );
}

export default App;
