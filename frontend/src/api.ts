const API = '/api';

export function getToken(): string {
  return localStorage.getItem('token') || '';
}

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const t = getToken();
  if (t) headers.Authorization = `Bearer ${t}`;
  return headers;
}

export async function request<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: { ...authHeaders(), ...(options.headers || {}) },
  });
  if (res.status === 401) {
    localStorage.removeItem('token');
    window.location.href = '/login';
    throw new Error('未授权');
  }
  if (!res.ok) {
    let msg = `请求失败 (${res.status})`;
    try {
      const body = await res.json();
      if (body.message) msg = Array.isArray(body.message) ? body.message.join(', ') : body.message;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.json();
}

export const login = (email: string, password: string) =>
  request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });

export const register = (email: string, password: string) =>
  request('/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) });

export const listDocuments = () => request('/documents');

export const deleteDocument = (id: string) =>
  request(`/documents/${id}`, { method: 'DELETE' });

export const uploadDocument = async (file: File) => {
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(`${API}/documents/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${getToken()}` },
    body: form,
  });
  if (!res.ok) throw new Error('上传失败');
  return res.json();
};

export const getConfig = () => request('/config');
export const updateConfig = (patch: Record<string, string>) =>
  request('/config', { method: 'PUT', body: JSON.stringify(patch) });

export interface Source {
  chunkId: string;
  documentId: string;
  filename: string;
  text: string;
  score: number;
}

export interface Step {
  type: string;
  title: string;
  status?: string;
  detail?: any;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  steps?: Step[];
  traceId?: string;
  createdAt: string;
}

export const listConversations = () => request<Conversation[]>('/conversations');

export const getConversationMessages = (id: string) =>
  request<StoredMessage[]>(`/conversations/${id}/messages`);

export interface ConversationStats {
  prompt: number;
  completion: number;
  total: number;
  summary: string | null;
  hasSummary: boolean;
}

export const getConversationStats = (id: string) =>
  request<ConversationStats>(`/conversations/${id}/stats`);

export const deleteConversation = (id: string) =>
  request(`/conversations/${id}`, { method: 'DELETE' });

export interface ChatEventHandlers {
  onTrace?: (traceId: string, conversationId: string) => void;
  onStep?: (step: Step) => void;
  onSources?: (sources: Source[]) => void;
  onToken?: (content: string) => void;
  onDone?: () => void;
  onError?: (message: string) => void;
}

export async function streamChat(
  message: string,
  history: { role: 'user' | 'assistant'; content: string }[],
  conversationId: string | null,
  handlers: ChatEventHandlers,
  signal?: AbortSignal,
) {
  const res = await fetch(`${API}/chat`, {
    method: 'POST',
    headers: { ...authHeaders(), Accept: 'text/event-stream' },
    body: JSON.stringify({ message, history, conversationId }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error('聊天请求失败');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload) continue;
      try {
        const evt = JSON.parse(payload);
        if (evt.type === 'trace') handlers.onTrace?.(evt.traceId, evt.conversationId);
        else if (evt.type === 'step') handlers.onStep?.(evt.step);
        else if (evt.type === 'sources') handlers.onSources?.(evt.sources);
        else if (evt.type === 'token') handlers.onToken?.(evt.content);
        else if (evt.type === 'done') handlers.onDone?.();
        else if (evt.type === 'error') handlers.onError?.(evt.message);
      } catch {
        /* ignore */
      }
    }
  }
}
