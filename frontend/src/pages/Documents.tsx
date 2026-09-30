import { useEffect, useRef, useState } from 'react';
import { deleteDocument, listDocuments, uploadDocument } from '../api';
import { Toolbar } from '../components/Toolbar';
import { PlusIcon, TrashIcon } from '../icons';

interface Doc {
  id: string;
  filename: string;
  mimeType: string;
  status: string;
  chunkCount: number;
  error?: string;
  createdAt: string;
}

export default function Documents() {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = async () => {
    const list = await listDocuments();
    setDocs(list);
    return list;
  };

  const stopPolling = () => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  };

  const startPolling = () => {
    stopPolling();
    pollTimer.current = setInterval(async () => {
      const list = await listDocuments();
      setDocs(list);
      if (list.every((d: Doc) => d.status !== 'processing')) {
        stopPolling();
        setMsg('');
      }
    }, 2000);
  };

  useEffect(() => {
    (async () => {
      const list = await refresh();
      if (list.some((d: Doc) => d.status === 'processing')) {
        startPolling();
      }
    })();
    return stopPolling;
  }, []);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setMsg('');
    try {
      await uploadDocument(file);
      setMsg(`${file.name} 已上传，正在解析与建图…`);
      await refresh();
      startPolling();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const onDelete = async (id: string) => {
    if (!confirm('确定删除该文档？将同时清除其向量和图谱数据。')) return;
    await deleteDocument(id);
    await refresh();
  };

  const statusMeta = (d: Doc) => {
    if (d.status === 'ready') return { text: '已就绪', cls: 'bg-mac-green/10 text-mac-green' };
    if (d.status === 'processing') return { text: '处理中', cls: 'bg-mac-orange/10 text-mac-orange' };
    return { text: '失败', cls: 'bg-mac-red/10 text-mac-red' };
  };

  return (
    <div className="flex h-full flex-col">
      <Toolbar title="文档库" subtitle="上传 PDF / Word / TXT / 图片，构建知识库">
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1.5 rounded-lg bg-mac-blue px-3 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <PlusIcon size={16} />
          {uploading ? '上传中…' : '上传'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,.docx,.txt,.png,.jpg,.jpeg,.webp"
          className="hidden"
          onChange={onPick}
        />
      </Toolbar>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-3xl">
          {msg && (
            <div className="mb-3 rounded-xl bg-mac-orange/10 px-4 py-2.5 text-sm text-mac-orange">
              {msg}
            </div>
          )}

          {docs.length === 0 ? (
            <div className="mt-20 text-center text-mac-subtext">
              <div className="mb-2 text-sm">暂无文档</div>
              <div className="text-xs">点击右上角「上传」添加文档开始构建知识库</div>
            </div>
          ) : (
            <div className="space-y-2">
              {docs.map((d) => {
                const s = statusMeta(d);
                return (
                  <div
                    key={d.id}
                    className="flex items-center justify-between rounded-xl border border-mac-line bg-white px-4 py-3 shadow-card"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[15px] font-medium text-mac-text">
                        {d.filename}
                      </div>
                      <div className="mt-0.5 text-xs text-mac-subtext">
                        {d.chunkCount > 0 ? `${d.chunkCount} 个分块 · ` : ''}
                        {new Date(d.createdAt).toLocaleString()}
                        {d.error ? ` · ${d.error}` : ''}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2.5">
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${s.cls}`}
                      >
                        {s.text}
                      </span>
                      <button
                        onClick={() => onDelete(d.id)}
                        className="rounded-lg p-1.5 text-mac-subtext transition-colors hover:bg-black/5 hover:text-mac-red"
                        title="删除"
                      >
                        <TrashIcon size={16} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}