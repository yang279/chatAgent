import React, { createContext, useCallback, useContext, useState } from 'react';
import { listConversations, Conversation } from './api';

interface ConversationContextValue {
  conversations: Conversation[];
  currentId: string | null;
  refresh: () => Promise<void>;
  open: (id: string | null) => void;
}

const ConversationContext = createContext<ConversationContextValue>({
  conversations: [],
  currentId: null,
  refresh: async () => {},
  open: () => {},
});

export function ConversationProvider({ children }: { children: React.ReactNode }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setConversations(await listConversations());
    } catch {
      /* ignore */
    }
  }, []);

  const open = useCallback((id: string | null) => setCurrentId(id), []);

  return (
    <ConversationContext.Provider value={{ conversations, currentId, refresh, open }}>
      {children}
    </ConversationContext.Provider>
  );
}

export function useConversations() {
  return useContext(ConversationContext);
}