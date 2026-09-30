import { useEffect, useState } from 'react';
import { getConfig, updateConfig } from '../api';
import { PERSONAS } from '../personas';
import { Toolbar } from '../components/Toolbar';

export default function Settings() {
  const [form, setForm] = useState({
    baseUrl: '',
    apiKey: '',
    llmModel: '',
    embeddingModel: '',
    visionModel: '',
    fastModel: '',
    persona: '',
  });
  const [presetId, setPresetId] = useState('default');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    (async () => {
      const cfg = await getConfig();
      const persona = cfg.persona || '';
      setForm({
        baseUrl: cfg.baseUrl || '',
        apiKey: '',
        llmModel: cfg.llmModel || '',
        embeddingModel: cfg.embeddingModel || '',
        visionModel: cfg.visionModel || '',
        fastModel: cfg.fastModel || '',
        persona,
      });
      setPresetId(
        PERSONAS.find((p) => p.text === persona)?.id ?? (persona ? 'custom' : 'default'),
      );
    })();
  }, []);

  const save = async () => {
    setMsg('');
    try {
      const patch: Record<string, string> = {
        baseUrl: form.baseUrl,
        llmModel: form.llmModel,
        embeddingModel: form.embeddingModel,
        visionModel: form.visionModel,
        fastModel: form.fastModel,
        persona: form.persona,
      };
      if (form.apiKey) patch.apiKey = form.apiKey;
      await updateConfig(patch);
      setMsg('已保存');
    } catch (err) {
      setMsg((err as Error).message);
    }
  };

  const onPickPreset = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    setPresetId(id);
    if (id === 'custom') return;
    const p = PERSONAS.find((x) => x.id === id);
    setForm({ ...form, persona: p?.text ?? '' });
  };

  const fields: { key: keyof typeof form; label: string; placeholder: string; type?: string }[] = [
    { key: 'baseUrl', label: 'API Base URL', placeholder: 'https://api.openai.com/v1' },
    { key: 'apiKey', label: 'API Key', placeholder: '留空则不修改', type: 'password' },
    { key: 'llmModel', label: '对话模型', placeholder: 'gpt-4o-mini' },
    { key: 'embeddingModel', label: 'Embedding 模型', placeholder: 'text-embedding-3-small' },
    { key: 'visionModel', label: '视觉模型', placeholder: 'gpt-4o-mini' },
    { key: 'fastModel', label: '快速模型', placeholder: '意图识别 / 重排' },
  ];

  return (
    <div className="flex h-full flex-col">
      <Toolbar title="设置" subtitle="模型与角色配置">
        <button
          onClick={save}
          className="rounded-lg bg-mac-blue px-3.5 py-1.5 text-sm font-medium text-white transition-opacity hover:opacity-90"
        >
          保存
        </button>
      </Toolbar>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-2xl space-y-4">
          <div className="overflow-hidden rounded-xl border border-mac-line bg-white shadow-card">
            <div className="border-b border-mac-line px-4 py-2.5 text-xs font-semibold text-mac-subtext">
              模型配置
            </div>
            {fields.map((f, i) => (
              <div
                key={f.key}
                className={`flex items-center gap-4 px-4 py-2.5 ${i ? 'border-t border-mac-line' : ''}`}
              >
                <span className="w-36 shrink-0 text-sm text-mac-text">{f.label}</span>
                <input
                  type={f.type || 'text'}
                  className="flex-1 rounded-lg bg-transparent px-2 py-1 text-sm text-mac-text placeholder:text-mac-subtext focus:outline-none"
                  placeholder={f.placeholder}
                  value={form[f.key]}
                  onChange={(e) => setForm({ ...form, [f.key]: e.target.value })}
                />
              </div>
            ))}
          </div>

          <div className="overflow-hidden rounded-xl border border-mac-line bg-white shadow-card">
            <div className="border-b border-mac-line px-4 py-2.5 text-xs font-semibold text-mac-subtext">
              角色性格
            </div>
            <div className="px-4 py-3">
              <select
                className="mb-3 w-full rounded-lg border border-mac-line bg-white px-3 py-2 text-sm text-mac-text focus:outline-none focus:ring-2 focus:ring-mac-blue/30"
                value={presetId}
                onChange={onPickPreset}
              >
                {PERSONAS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
                <option value="custom">自定义</option>
              </select>
              <textarea
                className="w-full resize-none rounded-lg border border-mac-line bg-white px-3 py-2 text-sm text-mac-text placeholder:text-mac-subtext focus:outline-none focus:ring-2 focus:ring-mac-blue/30"
                rows={3}
                placeholder="自定义角色性格描述（留空为默认助手）"
                value={form.persona}
                onChange={(e) => {
                  setPresetId('custom');
                  setForm({ ...form, persona: e.target.value });
                }}
              />
            </div>
          </div>

          {msg && <div className="text-center text-sm text-mac-subtext">{msg}</div>}
        </div>
      </div>
    </div>
  );
}