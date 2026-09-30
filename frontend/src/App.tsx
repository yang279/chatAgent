import { useEffect } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './auth';
import { ConversationProvider, useConversations } from './conversation';
import { deleteConversation } from './api';
import Login from './pages/Login';
import Chat from './pages/Chat';
import Documents from './pages/Documents';
import Settings from './pages/Settings';
import { FolderIcon, GearIcon, LogoutIcon, PlusIcon, TrashIcon } from './icons';

const nav = [
  { to: '/documents', label: '文档库', icon: FolderIcon },
  { to: '/settings', label: '设置', icon: GearIcon },
];

function Sidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { conversations, currentId, refresh, open } = useConversations();

  useEffect(() => {
    refresh();
  }, [refresh]);

  const newChat = () => {
    open(null);
    navigate('/');
  };

  const selectConv = (id: string) => {
    open(id);
    navigate('/');
  };

  const delConv = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await deleteConversation(id);
    if (currentId === id) open(null);
    refresh();
  };

  return (
    <aside className="glass flex w-60 flex-col border-r border-mac-line">
      <div className="flex items-center gap-2.5 px-5 pb-3 pt-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-mac-blue text-sm font-bold text-white shadow-sm">
          R
        </div>
        <span className="text-[15px] font-semibold text-mac-text">RAG Agent</span>
      </div>

      <div className="px-3 pb-2">
        <button
          onClick={newChat}
          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-[14px] font-medium text-mac-blue transition-colors hover:bg-mac-blue/10"
        >
          <PlusIcon size={16} />
          新建对话
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3">
        {conversations.map((c) => (
          <div
            key={c.id}
            onClick={() => selectConv(c.id)}
            className={`group flex cursor-pointer items-center justify-between rounded-lg px-2.5 py-1.5 text-[14px] transition-colors ${
              currentId === c.id
                ? 'bg-mac-blue/10 font-medium text-mac-blue'
                : 'text-mac-text hover:bg-black/5'
            }`}
          >
            <span className="truncate">{c.title}</span>
            <button
              onClick={(e) => delConv(e, c.id)}
              className="ml-2 hidden shrink-0 rounded p-0.5 text-mac-subtext hover:text-mac-red group-hover:block"
              title="删除会话"
            >
              <TrashIcon size={14} />
            </button>
          </div>
        ))}
        {conversations.length === 0 && (
          <div className="px-2.5 py-2 text-xs text-mac-subtext">暂无会话</div>
        )}
      </div>

      <nav className="space-y-0.5 border-t border-mac-line px-3 py-2">
        {nav.map((n) => {
          const Icon = n.icon;
          const active = location.pathname === n.to;
          return (
            <Link
              key={n.to}
              to={n.to}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[14px] transition-colors ${
                active ? 'bg-mac-blue/10 font-medium text-mac-blue' : 'text-mac-text hover:bg-black/5'
              }`}
            >
              <Icon size={18} />
              {n.label}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 pb-4">
        <div className="rounded-lg px-2.5 py-2">
          <div className="truncate text-xs text-mac-subtext">{user?.email}</div>
          <button
            onClick={() => {
              logout();
              navigate('/login');
            }}
            className="mt-1 flex items-center gap-1.5 text-xs text-mac-subtext transition-colors hover:text-mac-text"
          >
            <LogoutIcon size={14} />
            退出登录
          </button>
        </div>
      </div>
    </aside>
  );
}

function Layout() {
  return (
    <ConversationProvider>
      <div className="flex h-full">
        <Sidebar />
        <main className="flex flex-1 flex-col overflow-hidden bg-mac-bg">
          <Routes>
            <Route path="/" element={<Chat />} />
            <Route path="/documents" element={<Documents />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </main>
      </div>
    </ConversationProvider>
  );
}

export default function App() {
  const { token } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="*" element={token ? <Layout /> : <Navigate to="/login" replace />} />
    </Routes>
  );
}