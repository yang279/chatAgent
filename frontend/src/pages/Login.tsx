import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login, register } from '../api';
import { useAuth } from '../auth';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { setAuth } = useAuth();
  const navigate = useNavigate();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const fn = mode === 'login' ? login : register;
      const res = await fn(email, password);
      setAuth(res.token, res.user);
      navigate('/');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-mac-bg">
      <form
        onSubmit={submit}
        className="w-[340px] rounded-2xl border border-mac-line bg-white p-7 shadow-card"
      >
        <div className="mb-6 flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-mac-blue text-sm font-bold text-white">
            R
          </div>
          <h1 className="text-xl font-bold text-mac-text">RAG Agent</h1>
        </div>

        <input
          className="mb-3 w-full rounded-xl border border-mac-line px-3.5 py-2.5 text-[15px] text-mac-text placeholder:text-mac-subtext focus:outline-none focus:ring-2 focus:ring-mac-blue/30"
          type="email"
          placeholder="邮箱"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <input
          className="mb-3 w-full rounded-xl border border-mac-line px-3.5 py-2.5 text-[15px] text-mac-text placeholder:text-mac-subtext focus:outline-none focus:ring-2 focus:ring-mac-blue/30"
          type="password"
          placeholder={mode === 'login' ? '密码' : '密码（至少 6 位）'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={6}
        />

        {error && <div className="mb-3 text-sm text-mac-red">{error}</div>}

        <button
          className="w-full rounded-xl bg-mac-blue py-2.5 text-[15px] font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
          disabled={loading}
        >
          {loading ? '请稍候…' : mode === 'login' ? '登录' : '注册'}
        </button>

        <div className="mt-4 text-center text-sm text-mac-subtext">
          {mode === 'login' ? (
            <span>
              没有账号？{' '}
              <button type="button" className="font-medium text-mac-blue" onClick={() => setMode('register')}>
                注册
              </button>
            </span>
          ) : (
            <span>
              已有账号？{' '}
              <button type="button" className="font-medium text-mac-blue" onClick={() => setMode('login')}>
                登录
              </button>
            </span>
          )}
        </div>
      </form>
    </div>
  );
}