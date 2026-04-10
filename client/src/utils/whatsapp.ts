import { toast } from 'sonner';

// Backend API base URL — empty string = same origin (works in both dev proxy and prod)
const API_URL = '';

export interface WhatsAppStatus {
  isAuthenticated: boolean;
  isReady: boolean;
  hasQrCode: boolean;
  channelTarget: { id: string; name: string } | null;
}

export interface Channel {
  id: string;
  name: string;
  isGroup: boolean;
}

export interface ScheduleConfig {
  time: string;
  template: string;
  enabled: boolean;
}

/** Generic fetch wrapper with error handling */
async function apiFetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export async function getWhatsAppStatus(): Promise<WhatsAppStatus> {
  return apiFetch('/api/status');
}

export async function getQRCode(): Promise<string | null> {
  try {
    const data = await apiFetch<{ qrCode: string | null }>('/api/qr');
    return data.qrCode;
  } catch {
    return null;
  }
}

export async function getChannels(): Promise<Channel[]> {
  const data = await apiFetch<{ channels: Channel[] }>('/api/channels');
  return data.channels;
}

export async function setChannelTarget(channelId: string, channelName: string): Promise<void> {
  await apiFetch('/api/channel/target', {
    method: 'POST',
    body: JSON.stringify({ channelId, channelName }),
  });
}

export async function getChannelTarget(): Promise<{ id: string; name: string } | null> {
  try {
    return await apiFetch('/api/channel/target');
  } catch {
    return null;
  }
}

export async function sendToWhatsAppChannel(message: string): Promise<boolean> {
  const data = await apiFetch<{ success: boolean }>('/api/send', {
    method: 'POST',
    body: JSON.stringify({ message }),
  });
  return data.success;
}

export async function scheduleTask(time: string, template: string, enabled: boolean): Promise<void> {
  await apiFetch('/api/schedule', {
    method: 'POST',
    body: JSON.stringify({ time, template, enabled }),
  });
}

export async function getSchedule(): Promise<ScheduleConfig> {
  return apiFetch('/api/schedule');
}

export async function logoutWhatsApp(): Promise<void> {
  await apiFetch('/api/logout', { method: 'POST' });
}

export async function restartWhatsApp(): Promise<void> {
  await apiFetch('/api/restart', { method: 'POST' });
}

export async function runAgentNow(): Promise<{ success: boolean; quiz: any; message: string }> {
  return apiFetch('/api/run', { method: 'POST' });
}

export async function getHistory(): Promise<{ history: any[] }> {
  return apiFetch('/api/history');
}

export async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
}

/** Create WebSocket connection with auto-reconnect */
export function createWebSocketConnection(onMessage: (data: any) => void): WebSocket {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = window.location.host;

  const connect = (): WebSocket => {
    const ws = new WebSocket(`${protocol}//${host}`);

    ws.onopen = () => console.log('WebSocket connected');

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        onMessage(data);
      } catch (err) {
        console.error('WS parse error:', err);
      }
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected. Reconnecting in 3s...');
      setTimeout(() => connect(), 3000);
    };

    ws.onerror = (err) => console.error('WebSocket error:', err);

    return ws;
  };

  return connect();
}
