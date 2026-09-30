import { useEffect, useRef, useState } from 'react';
import { streamChat, Source, Step, getConversationMessages, getConversationStats } from '../api';
import { useConversations } from '../conversation';
import { Toolbar } from '../components/Toolbar';
import { SendIcon, SparkleIcon, StopIcon } from '../icons';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  steps?: Step[];
  traceId?: string;
}

function Detail({ type, detail }: { type: string; detail?: any }) {
  if (!detail) return null;
  if (type === 'intent') {
    const need = !!detail.needRetrieval;
    const entities: string[] = detail.entities || [];
    return (
      <div className="text-mac-subtext">
        {need ? '需要检索' : '无需检索'}
        {need && entities.length > 0 ? ` · 实体：${entities.join('、')}` : ''}
      </div>
    );
  }
  if (type === 'retrieval') {
    return (
      <div className="text-mac-subtext">
        命中 {detail.count} 条
        {(detail.top || []).map((t: any, i: number) => (
          <div key={i} className="mt-0.5 truncate">
            · {t.text}… <span className="opacity-60">({t.score})</span>
          </div>
        ))}
      </div>
    );
  }
  if (type === 'rerank') {
    return (
      <div className="text-mac-subtext">
        候选 {detail.candidates} → 选取 {detail.selected}
      </div>
    );
  }
  if (type === 'thinking') {
    return (
      <details className="mt-1">
        <summary className="cursor-pointer text-mac-subtext">查看思考内容</summary>
        <div className="mt-1 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-lg bg-mac-bg p-2 text-mac-text">
          {detail.text}
        </div>
      </details>
    );
  }
  return <div className="truncate text-mac-subtext">{JSON.stringify(detail)}</div>;
}

const dotColor: Record<string, string> = {
  intent: 'bg-mac-blue',
  retrieval: 'bg-mac-green',
  rerank: 'bg-mac-orange',
  thinking: 'bg-mac-text',
  done: 'bg-mac-subtext',
};

function StepRow({ step }: { step: Step }) {
  const dot = dotColor[step.type] || 'bg-mac-subtext';
  return (
    <div className="flex gap-2">
      <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
      <div className="min-w-0 flex-1 text-xs">
        <div className="font-medium text-mac-text">{step.title}</div>
        <Detail type={step.type} detail={step.detail} />
      </div>
    </div>
  );
}

export default function Chat() {
  const { currentId, open, refresh } = useConversations();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [stats, setStats] = useState<{ total: number; hasSummary: boolean } | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!currentId) {
        setMessages([]);
        setStats(null);
        return;
      }
      try {
        const [list, s] = await Promise.all([
          getConversationMessages(currentId),
          getConversationStats(currentId),
        ]);
        if (cancelled) return;
        setMessages(
          list.map((m) => ({
            role: m.role,
            content: m.content,
            sources: m.sources || [],
            steps: m.steps || [],
            traceId: m.traceId,
          })),
        );
        setStats({ total: s.total, hasSummary: s.hasSummary });
      } catch {
        if (!cancelled) {
          setMessages([]);
          setStats(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const updateMessage = (traceId: string, updater: (m: Message) => Message) => {
    setMessages((prev) => {
      let changed = false;
      const next = prev.map((m) => {
        if (m.traceId === traceId) {
          changed = true;
          return updater(m);
        }
        return m;
      });
      return changed ? next : prev;
    });
  };

  const loadStats = async (id: string) => {
    try {
      const s = await getConversationStats(id);
      setStats({ total: s.total, hasSummary: s.hasSummary });
    } catch {
      setStats(null);
    }
  };

  const stop = () => {
    abortRef.current?.abort();
  };

  const send = async () => {
    const text = input.trim();
    if (!text || streaming) return;
    setInput('');
    setStreaming(true);

    const originConvId = currentId;
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    setMessages((prev) => [...prev, { role: 'user', content: text }]);

    const controller = new AbortController();
    abortRef.current = controller;

    let createdConvId: string | null = null;
    let assistantTraceId: string | null = null;

    try {
      await streamChat(
        text,
        history,
        originConvId,
        {
          onTrace: (traceId, conversationId) => {
            assistantTraceId = traceId;
            createdConvId = conversationId;
            if (!originConvId) refresh();
            setMessages((prev) => [
              ...prev,
              { role: 'assistant', content: '', sources: [], steps: [], traceId },
            ]);
          },
          onSources: (sources) => {
            if (assistantTraceId) updateMessage(assistantTraceId, (m) => ({ ...m, sources }));
          },
          onStep: (step) => {
            if (assistantTraceId)
              updateMessage(assistantTraceId, (m) => ({ ...m, steps: [...(m.steps || []), step] }));
          },
          onToken: (content) => {
            if (assistantTraceId)
              updateMessage(assistantTraceId, (m) => ({ ...m, content: m.content + content }));
          },
          onError: (message) => {
            if (assistantTraceId)
              updateMessage(assistantTraceId, (m) => ({
                ...m,
                content: m.content || `错误：${message}`,
              }));
          },
        },
        controller.signal,
      );
    } catch (err) {
      if ((err as Error)?.name !== 'AbortError' && assistantTraceId) {
        updateMessage(assistantTraceId, (m) => ({
          ...m,
          content: m.content || `错误：${(err as Error).message}`,
        }));
      }
    } finally {
      setStreaming(false);
      if (abortRef.current === controller) abortRef.current = null;
    }

    if (!originConvId && createdConvId) open(createdConvId);
    refresh();
    const finalId = originConvId || createdConvId;
    if (finalId) loadStats(finalId);
  };

  return (
    <div className="flex h-full flex-col">
      <Toolbar
        title="对话"
        subtitle={
          stats
            ? `${stats.total.toLocaleString()} tokens${stats.hasSummary ? ' · 已压缩更早对话' : ''}`
            : '基于知识库的智能问答'
        }
      />

      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {messages.length === 0 && (
            <div className="mt-24 flex flex-col items-center text-center">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-white text-mac-blue shadow-card">
                <SparkleIcon size={28} />
              </div>
              <div className="text-[15px] font-medium text-mac-text">开始提问</div>
              <div className="mt-1 text-sm text-mac-subtext">
                上传文档后，我会基于知识库回答，并展示思考与召回过程
              </div>
            </div>
          )}

          {messages.map((m, i) => {
            const isUser = m.role === 'user';
            return (
              <div key={i} className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`flex max-w-[75%] flex-col gap-1.5 ${isUser ? 'items-end' : 'items-start'}`}
                >
                  {m.steps && m.steps.length > 0 && (
                    <details className="w-full rounded-xl border border-mac-line bg-white shadow-card">
                      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-semibold text-mac-subtext">
                        过程时间线（{m.steps.length} 步）
                      </summary>
                      <div className="space-y-2 border-t border-mac-line px-3 py-2.5">
                        {m.steps.map((s, idx) => (
                          <StepRow key={idx} step={s} />
                        ))}
                      </div>
                    </details>
                  )}

                  <div
                    className={`whitespace-pre-wrap px-4 py-2.5 text-[15px] leading-relaxed ${
                      isUser
                        ? 'rounded-2xl rounded-tr-md bg-mac-blue text-white'
                        : 'rounded-2xl rounded-tl-md bg-mac-bubble text-mac-text'
                    }`}
                  >
                    {m.content || (streaming && <span className="text-mac-subtext">思考中…</span>)}
                  </div>

                  {m.sources && m.sources.length > 0 && (
                    <div className="w-full rounded-xl border border-mac-line bg-white p-3 shadow-card">
                      <div className="mb-1.5 text-xs font-semibold text-mac-subtext">引用来源</div>
                      <div className="space-y-1.5">
                        {m.sources.map((s, idx) => (
                          <div key={idx} className="text-xs text-mac-subtext">
                            <span className="font-medium text-mac-blue">[{s.filename}]</span>{' '}
                            {s.text.slice(0, 120)}…
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
      </div>

      <div className="glass border-t border-mac-line px-4 py-3">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <input
            className="flex-1 rounded-2xl border border-mac-line bg-white px-4 py-2.5 text-[15px] text-mac-text placeholder:text-mac-subtext focus:outline-none focus:ring-2 focus:ring-mac-blue/30"
            placeholder="输入消息，回车发送"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !(e.nativeEvent as KeyboardEvent).isComposing) {
                e.preventDefault();
                send();
              }
            }}
          />
          {streaming ? (
            <button
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-mac-red text-white transition-opacity hover:opacity-90"
              onClick={stop}
              title="停止"
            >
              <StopIcon size={16} />
            </button>
          ) : (
            <button
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-mac-blue text-white transition-opacity disabled:opacity-40"
              onClick={send}
              disabled={!input.trim()}
              title="发送"
            >
              <SendIcon size={18} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}