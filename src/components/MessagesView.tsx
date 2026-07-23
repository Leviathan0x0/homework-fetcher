import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Conversation, Message } from '../types/homework';
import { cn } from '../utils/cn';
import {
  MessageCircle,
  Plus,
  X,
  Loader2,
  Send,
  ArrowLeft,
  Search,
  UserCheck,
  AlertCircle,
  FolderOpen,
  CheckCheck,
} from 'lucide-react';

interface MessagesViewProps {
  userSection?: string;
}

export const MessagesView: React.FC<MessagesViewProps> = ({ userSection }) => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);

  const [showNewModal, setShowNewModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ id: string; studentId: string }[]>([]);
  const [searching, setSearching] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchConversations = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/conversations', { headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      const data = await res.json();
      setConversations(data.conversations || []);
    } catch {} finally { setIsLoading(false); }
  }, []);

  useEffect(() => { fetchConversations(); }, [fetchConversations]);

  const fetchMessages = useCallback(async (convId: string) => {
    setMessagesLoading(true);
    try {
      const res = await fetch(`/api/conversations/${encodeURIComponent(convId)}/messages`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return;
      const data = await res.json();
      setMessages(data.messages || []);
      fetch(`/api/conversations/${encodeURIComponent(convId)}/read`, { method: 'PATCH' }).catch(() => {});
    } catch {} finally { setMessagesLoading(false); }
  }, []);

  useEffect(() => {
    if (activeConvId) {
      fetchMessages(activeConvId);
      setConversations((prev) =>
        prev.map((c) => (c.id === activeConvId ? { ...c, unreadCount: 0 } : c))
      );
    }
  }, [activeConvId, fetchMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!inputText.trim() || !activeConvId || sending) return;
    setSending(true);
    const text = inputText.trim();
    setInputText('');
    try {
      const res = await fetch(`/api/conversations/${encodeURIComponent(activeConvId)}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ content: text }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setMessages((prev) => [...prev, data.message]);
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeConvId
            ? { ...c, lastMessagePreview: text.substring(0, 80), lastMessageAt: data.message.createdAt }
            : c
        )
      );
    } catch {} finally { setSending(false); }
  };

  const handleSearch = async (q: string) => {
    setSearchQuery(q);
    if (!q.trim()) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return;
      const data = await res.json();
      setSearchResults(data.users || []);
    } catch {} finally { setSearching(false); }
  };

  const handleStartConversation = async (participantId: string) => {
    try {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ participantId }),
      });
      if (!res.ok) return;
      const data = await res.json();
      setShowNewModal(false);
      setSearchQuery('');
      setSearchResults([]);
      setActiveConvId(data.conversationId);
      fetchConversations();
      setTimeout(() => fetchMessages(data.conversationId), 100);
    } catch {}
  };

  const activeConv = conversations.find((c) => c.id === activeConvId);
  const otherName = activeConv?.otherUser?.studentId || 'Conversation';

  const inboxContent = (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200/80 dark:border-neutral-800/80 shrink-0">
        <h2 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">Messages</h2>
        <button onClick={() => setShowNewModal(true)}
          className="p-1.5 rounded-lg text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
          title="New message">
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {conversations.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <div className="w-12 h-12 rounded-2xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-neutral-400 mb-3">
            <MessageCircle className="w-6 h-6" />
          </div>
          <h3 className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">No conversations yet</h3>
          <p className="text-xs text-neutral-500 mt-1 mb-4">Start a conversation with someone in your section.</p>
          <button onClick={() => setShowNewModal(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-2xl bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 text-xs font-medium shadow-2xs cursor-pointer">
            <Plus className="w-3.5 h-3.5" /><span>New Message</span>
          </button>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto divide-y divide-neutral-100 dark:divide-neutral-800/60">
          {conversations.map((conv) => (
            <button key={conv.id} onClick={() => setActiveConvId(conv.id)}
              className={cn(
                'w-full text-left px-4 py-3 flex items-center gap-3 transition-colors cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-900/50',
                activeConvId === conv.id && 'bg-neutral-100 dark:bg-neutral-800/40'
              )}>
              <div className="w-9 h-9 rounded-2xl bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center text-xs font-bold text-neutral-600 dark:text-neutral-300 shrink-0">
                {conv.otherUser?.studentId?.charAt(0).toUpperCase() || '?'}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-neutral-900 dark:text-neutral-100 truncate">
                    {conv.otherUser?.studentId || 'Unknown'}
                  </span>
                  {conv.lastMessageAt && (
                    <span className="text-[10px] text-neutral-400 shrink-0">
                      {new Date(conv.lastMessageAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
                {conv.lastMessagePreview && (
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate mt-0.5">{conv.lastMessagePreview}</p>
                )}
              </div>
              {conv.unreadCount > 0 && (
                <span className="flex size-5 items-center justify-center rounded-full bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-[10px] font-bold shrink-0">
                  {conv.unreadCount}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const threadContent = (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-neutral-200/80 dark:border-neutral-800/80 shrink-0">
        <button onClick={() => setActiveConvId(null)}
          className="md:hidden p-1 rounded-lg text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer">
          <ArrowLeft className="w-4 h-4" />
        </button>
        <div className="w-8 h-8 rounded-2xl bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center text-xs font-bold text-neutral-600 dark:text-neutral-300 shrink-0">
          {otherName.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0">
          <span className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{otherName}</span>
          <span className="text-[10px] text-neutral-400 ml-2">{userSection}</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messagesLoading ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-neutral-400" /></div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center py-8 text-xs text-neutral-400">No messages yet. Say hello!</div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={cn('flex', m.isMine ? 'justify-end' : 'justify-start')}>
              <div className={cn(
                'max-w-[75%] px-3.5 py-2 rounded-2xl text-xs leading-relaxed',
                m.isMine
                  ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 rounded-br-md'
                  : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 rounded-bl-md'
              )}>
                <p className="whitespace-pre-wrap break-words">{m.content}</p>
                <span className={cn('block text-[10px] mt-1 opacity-50', m.isMine ? 'text-right' : 'text-left')}>
                  {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="px-4 py-3 border-t border-neutral-200/80 dark:border-neutral-800/80 shrink-0">
        <div className="flex items-center gap-2">
          <input type="text" value={inputText} onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
            placeholder="Type a message..."
            className="flex-1 text-xs h-10 px-3.5 rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-400/20" />
          <button onClick={handleSend} disabled={!inputText.trim() || sending}
            className="p-2.5 rounded-2xl bg-neutral-900 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:opacity-90 transition-opacity disabled:opacity-30 cursor-pointer shrink-0">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-neutral-200/80 dark:border-neutral-800">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-neutral-900 dark:text-neutral-100">Messages</h1>
          <p className="text-xs sm:text-sm text-neutral-500 dark:text-neutral-400 mt-1">Chat privately with classmates in your section.</p>
        </div>
      </div>

      <div className="rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#141417] overflow-hidden" style={{ height: 'calc(100vh - 280px)', minHeight: '400px' }}>
        <div className="flex h-full">
          <div className={cn(
            'w-full md:w-72 md:border-r border-neutral-200/80 dark:border-neutral-800/80 overflow-hidden',
            activeConvId ? 'hidden md:flex md:flex-col' : 'flex flex-col'
          )}>
            {inboxContent}
          </div>
          <div className={cn(
            'flex-1 flex flex-col overflow-hidden',
            !activeConvId ? 'hidden md:flex' : 'flex'
          )}>
            {activeConvId ? threadContent : (
              <div className="flex-1 flex items-center justify-center text-xs text-neutral-400">
                Select a conversation to start chatting
              </div>
            )}
          </div>
        </div>
      </div>

      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-3xl bg-white dark:bg-[#141417] border border-neutral-200 dark:border-neutral-800 shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-neutral-900 dark:text-neutral-100">New Message</h3>
              <button onClick={() => { setShowNewModal(false); setSearchQuery(''); setSearchResults([]); }}
                className="p-1.5 rounded-full text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-400" />
              <input type="text" value={searchQuery} onChange={(e) => handleSearch(e.target.value)}
                placeholder="Search by student ID..."
                className="w-full text-xs h-11 pl-9 pr-3.5 rounded-2xl border border-neutral-200/80 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-2 focus:ring-neutral-400/20" />
            </div>
            <div className="space-y-1 max-h-60 overflow-y-auto">
              {searching ? (
                <div className="flex items-center justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-neutral-400" /></div>
              ) : searchResults.length > 0 ? (
                searchResults.map((u) => (
                  <button key={u.id} onClick={() => handleStartConversation(u.id)}
                    className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-2xl hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer group">
                    <div className="w-8 h-8 rounded-xl bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center text-xs font-bold text-neutral-600 dark:text-neutral-300 shrink-0">
                      {u.studentId.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <span className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">{u.studentId}</span>
                    </div>
                  </button>
                ))
              ) : searchQuery.trim() ? (
                <p className="text-xs text-neutral-400 text-center py-4">No users found</p>
              ) : (
                <p className="text-xs text-neutral-400 text-center py-4">Type a student ID to search</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
