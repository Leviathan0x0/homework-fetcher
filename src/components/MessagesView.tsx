import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Conversation, Message } from '../types/homework';
import { cn } from '../utils/cn';
import { MarkdownRenderer } from './MarkdownRenderer';
import {
  MessageCircle,
  Plus,
  X,
  Loader2,
  ArrowUp,
  ArrowLeft,
  Search,
  Paperclip,
  Eye,
  FileText,
  Download,
  ExternalLink,
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
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);

  const [previewMedia, setPreviewMedia] = useState<{ url: string; name: string; isImage: boolean } | null>(null);

  const [showNewModal, setShowNewModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<
    { id: string; studentId: string; displayName?: string | null; section?: string }[]
  >([]);
  const [searching, setSearching] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const userLabel = (u?: { displayName?: string | null; studentId?: string } | null) =>
    u?.displayName || u?.studentId || 'Unknown';

  const isMobileDevice = () => {
    if (typeof window === 'undefined') return false;
    return ('ontouchstart' in window || navigator.maxTouchPoints > 0) && window.innerWidth < 768;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter') {
      if (isMobileDevice()) {
        // Mobile device: Enter inserts a new line. Sending requires clicking the send button.
        return;
      }
      if (!e.shiftKey) {
        // Desktop: Enter sends message, Shift+Enter inserts a new line.
        e.preventDefault();
        handleSend();
      }
    }
  };

  const fetchConversations = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/conversations', { headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      const data = await res.json();
      setConversations(data.conversations || []);
    } catch {} finally { setIsLoading(false); }
  }, []);

  useEffect(() => {
    fetchConversations();
    const interval = setInterval(() => {
      fetchConversations();
    }, 2500);
    return () => clearInterval(interval);
  }, [fetchConversations]);

  useEffect(() => {
    const handleOpenConv = (e: any) => {
      const convId = e.detail;
      if (convId) {
        setActiveConvId(convId);
      }
    };
    window.addEventListener('open_conversation', handleOpenConv);
    return () => window.removeEventListener('open_conversation', handleOpenConv);
  }, []);

  const fetchMessages = useCallback(async (convId: string, silent: boolean = false) => {
    if (!silent) setMessagesLoading(true);
    try {
      const res = await fetch(`/api/conversations/${encodeURIComponent(convId)}/messages`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return;
      const data = await res.json();
      setMessages(data.messages || []);
      fetch(`/api/conversations/${encodeURIComponent(convId)}/read`, { method: 'PATCH' }).catch(() => {});
    } catch {} finally {
      if (!silent) setMessagesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!activeConvId) return;

    fetchMessages(activeConvId);
    setConversations((prev) =>
      prev.map((c) => (c.id === activeConvId ? { ...c, unreadCount: 0 } : c))
    );

    const messageInterval = setInterval(() => {
      fetchMessages(activeConvId, true);
    }, 2000);
    return () => clearInterval(messageInterval);
  }, [activeConvId, fetchMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (previewMedia) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [previewMedia]);

  const handleSend = async () => {
    if ((!inputText.trim() && !selectedFile) || !activeConvId || sending) return;
    setSending(true);

    const formData = new FormData();
    if (inputText.trim()) formData.append('content', inputText.trim());
    if (selectedFile) formData.append('file', selectedFile);

    const textCopy = inputText;
    const fileCopy = selectedFile;

    setInputText('');
    setSelectedFile(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    try {
      const res = await fetch(`/api/conversations/${encodeURIComponent(activeConvId)}/messages`, {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: formData,
      });
      if (!res.ok) {
        setInputText(textCopy);
        setSelectedFile(fileCopy);
        return;
      }
      const data = await res.json();
      setMessages((prev) => [...prev, data.message]);
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeConvId
            ? {
                ...c,
                lastMessagePreview: fileCopy ? `[Attachment] ${fileCopy.name}` : textCopy.substring(0, 80),
                lastMessageAt: data.message.createdAt,
              }
            : c
        )
      );
    } catch {
      setInputText(textCopy);
      setSelectedFile(fileCopy);
    } finally { setSending(false); }
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
      const picked = searchResults.find((u) => u.id === participantId);
      if (picked) {
        setConversations((prev) =>
          prev.some((c) => c.id === data.conversationId)
            ? prev
            : [
                {
                  id: data.conversationId,
                  otherUser: {
                    id: picked.id,
                    studentId: picked.studentId,
                    displayName: picked.displayName ?? null,
                    section: picked.section || '',
                  },
                  unreadCount: 0,
                },
                ...prev,
              ]
        );
      }
      setShowNewModal(false);
      setSearchQuery('');
      setSearchResults([]);
      setActiveConvId(data.conversationId);
      fetchConversations();
      setTimeout(() => fetchMessages(data.conversationId), 100);
    } catch {}
  };

  const activeConv = conversations.find((c) => c.id === activeConvId);
  const otherName = activeConv ? userLabel(activeConv.otherUser) : 'Conversation';
  const otherSection = activeConv?.otherUser?.section;

  const inboxContent = (
    <div className="h-full flex flex-col bg-neutral-50/80 dark:bg-[#121215]">
      {/* Header bar without WHATSAPP CHATS text - clean & subtle */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200/80 dark:border-neutral-800/80 shrink-0">
        <span className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">Messages</span>
        <button onClick={() => setShowNewModal(true)}
          className="p-1.5 rounded-xl text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200/70 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
          title="New Chat">
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {conversations.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <div className="w-10 h-10 rounded-2xl bg-neutral-200/60 dark:bg-neutral-800 flex items-center justify-center text-neutral-400 mb-2">
            <MessageCircle className="w-5 h-5" />
          </div>
          <p className="text-xs text-neutral-500">No active conversations</p>
          <button onClick={() => setShowNewModal(true)}
            className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 text-xs font-medium cursor-pointer shadow-2xs">
            <Plus className="w-3.5 h-3.5" /><span>New Chat</span>
          </button>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto divide-y divide-neutral-200/40 dark:divide-neutral-800/40">
          {conversations.map((conv) => (
            <button key={conv.id} onClick={() => setActiveConvId(conv.id)}
              className={cn(
                'w-full text-left px-3.5 py-3 flex items-center gap-3 transition-all cursor-pointer hover:bg-neutral-200/40 dark:hover:bg-neutral-800/40',
                activeConvId === conv.id && 'bg-neutral-200/80 dark:bg-neutral-800/80 font-medium'
              )}>
              <div className="w-9 h-9 rounded-xl bg-neutral-300 dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 flex items-center justify-center text-xs font-bold shrink-0">
                {userLabel(conv.otherUser).charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-xs font-semibold text-neutral-900 dark:text-neutral-100 truncate">
                      {userLabel(conv.otherUser)}
                    </span>
                    {conv.otherUser?.section && (
                      <span className="px-1.5 py-0.2 rounded text-[9px] font-medium bg-neutral-200/70 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 shrink-0">
                        {conv.otherUser.section}
                      </span>
                    )}
                  </div>
                  {conv.lastMessageAt && (
                    <span className="text-[10px] text-neutral-400 shrink-0">
                      {new Date(conv.lastMessageAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>
                {conv.lastMessagePreview && (
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate mt-0.5">{conv.lastMessagePreview}</p>
                )}
              </div>
              {conv.unreadCount > 0 && (
                <span className="flex size-4 items-center justify-center rounded-full bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 text-[10px] font-bold shrink-0">
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
    <div className="h-full flex flex-col bg-white dark:bg-[#09090b] relative">
      {/* Header bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200/80 dark:border-neutral-800/80 shrink-0 bg-neutral-50/50 dark:bg-[#121215]/50 backdrop-blur-xs z-10">
        <div className="flex items-center gap-3 min-w-0">
          <button onClick={() => setActiveConvId(null)}
            className="md:hidden p-1 rounded-lg text-neutral-500 hover:text-neutral-900 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer">
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="w-8 h-8 rounded-xl bg-neutral-200 dark:bg-neutral-800 text-neutral-900 dark:text-neutral-100 flex items-center justify-center text-xs font-bold shrink-0">
            {otherName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-neutral-900 dark:text-neutral-100">{otherName}</span>
              {otherSection && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 border border-neutral-200/60 dark:border-neutral-700/60">
                  {otherSection}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Messages Scroll View */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-neutral-50/30 dark:bg-[#09090b]">
        {messagesLoading ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="w-4 h-4 animate-spin text-neutral-400" /></div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-xs text-neutral-400">
            No messages yet. Send a message to start conversation!
          </div>
        ) : (
          messages.map((m) => {
            const isMine = Boolean(m.isMine);
            const isImage = m.mimeType?.startsWith('image/') || m.attachmentUrl?.match(/\.(jpg|jpeg|png|webp|gif|svg)$/i);
            const timeStr = new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            return (
              <div key={m.id} className={cn('flex w-full', isMine ? 'justify-end' : 'justify-start')}>
                <div className={cn(
                  'max-w-[75%] sm:max-w-[65%] p-3 rounded-2xl text-xs shadow-2xs relative group',
                  isMine
                    ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 rounded-tr-xs'
                    : 'bg-neutral-200/80 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100 rounded-tl-xs'
                )}>
                  {/* Attachment Box with Preview */}
                  {m.attachmentUrl && (
                    <div className="mb-2 rounded-xl overflow-hidden border border-black/10 dark:border-white/10 bg-black/5 dark:bg-black/20 p-2 space-y-1.5">
                      {isImage ? (
                        <div className="relative group/img overflow-hidden rounded-lg max-h-48 bg-neutral-900/10">
                          <img
                            src={m.attachmentUrl}
                            alt={m.originalFilename || 'Attachment'}
                            className="w-full h-auto object-cover max-h-48 rounded-lg"
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center gap-2">
                            <button
                              onClick={() => setPreviewMedia({ url: m.attachmentUrl!, name: m.originalFilename || 'Image', isImage: true })}
                              className="p-1.5 rounded-full bg-white/90 text-neutral-900 hover:scale-105 transition-transform cursor-pointer"
                              title="Preview photo in-app"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            <a
                              href={m.attachmentUrl}
                              download={m.originalFilename || 'photo'}
                              className="p-1.5 rounded-full bg-white/90 text-neutral-900 hover:scale-105 transition-transform cursor-pointer"
                              title="Download photo"
                            >
                              <Download className="w-4 h-4" />
                            </a>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-2 p-1.5">
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText className="w-4 h-4 opacity-70 shrink-0" />
                            <span className="text-xs font-medium truncate">{m.originalFilename || 'Document'}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => setPreviewMedia({ url: m.attachmentUrl!, name: m.originalFilename || 'File', isImage: false })}
                              className="p-1 rounded-md hover:bg-black/10 dark:hover:bg-white/10 transition-colors cursor-pointer"
                              title="Preview file"
                            >
                              <Eye className="w-3.5 h-3.5" />
                            </button>
                            <a
                              href={m.attachmentUrl}
                              download={m.originalFilename || 'file'}
                              className="p-1 rounded-md hover:bg-black/10 dark:hover:bg-white/10 transition-colors cursor-pointer"
                              title="Download"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </a>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Message Content & Inline Date/Time Displayed on the Right or Left */}
                  <div className="flex items-end justify-between gap-3">
                    {m.content && (
                      <MarkdownRenderer content={m.content} className="break-words leading-relaxed flex-1 text-xs" />
                    )}
                    <span className={cn(
                      'text-[9px] shrink-0 font-mono self-end opacity-60 ml-2 mb-0.5',
                      isMine ? 'text-neutral-300 dark:text-neutral-600' : 'text-neutral-500 dark:text-neutral-400'
                    )}>
                      {timeStr}
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input bar with auto-expanding textarea & Shift+Enter support */}
      <div className="p-3 pb-20 md:pb-3 border-t border-neutral-200/80 dark:border-neutral-800/80 shrink-0 bg-white dark:bg-[#121215] z-20">
        {selectedFile && (
          <div className="mb-2 p-2 rounded-xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <Paperclip className="w-4 h-4 text-neutral-500 shrink-0" />
              <span className="font-medium truncate">{selectedFile.name}</span>
            </div>
            <button onClick={() => setSelectedFile(null)} className="p-1 rounded-full text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 cursor-pointer">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className="flex items-end gap-2">
          <input
            type="file"
            ref={fileInputRef}
            onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="p-2.5 rounded-xl text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer mb-0.5"
            title="Attach photo or document"
          >
            <Paperclip className="w-4 h-4" />
          </button>

          <textarea
            ref={textareaRef}
            rows={1}
            value={inputText}
            onChange={(e) => {
              setInputText(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
            }}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            className="flex-1 text-xs py-2.5 px-3.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-1 focus:ring-neutral-400 dark:focus:ring-neutral-500 resize-none max-h-32 leading-relaxed overflow-y-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none] [-ms-overflow-style:none]"
          />

          <button onClick={handleSend} disabled={(!inputText.trim() && !selectedFile) || sending}
            className="p-2.5 rounded-xl bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 hover:opacity-90 transition-opacity disabled:opacity-30 cursor-pointer shrink-0 shadow-2xs mb-0.5">
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="h-full w-full flex bg-white dark:bg-[#09090b] overflow-hidden min-h-0">
      <div className={cn(
        'w-full md:w-80 border-r border-neutral-200/80 dark:border-neutral-800/80 overflow-hidden shrink-0 min-h-0',
        activeConvId ? 'hidden md:flex md:flex-col' : 'flex flex-col'
      )}>
        {inboxContent}
      </div>
      <div className={cn(
        'flex-1 flex flex-col overflow-hidden min-h-0',
        !activeConvId ? 'hidden md:flex' : 'flex'
      )}>
        {activeConvId ? threadContent : (
          <div className="flex-1 flex flex-col items-center justify-center text-xs text-neutral-400 gap-2 bg-neutral-50/20 dark:bg-[#09090b]">
            <MessageCircle className="w-8 h-8 opacity-20" />
            <span>Select a conversation to view messages</span>
          </div>
        )}
      </div>

      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#141417] border border-neutral-200 dark:border-neutral-800 shadow-2xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">New Message</h3>
              <button onClick={() => { setShowNewModal(false); setSearchQuery(''); setSearchResults([]); }}
                className="p-1 rounded-full text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors cursor-pointer">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-neutral-400" />
              <input type="text" value={searchQuery} onChange={(e) => handleSearch(e.target.value)}
                placeholder="Search by name or student ID across any section..."
                className="w-full text-xs h-9 pl-8 pr-3 rounded-xl border border-neutral-200/80 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-1 focus:ring-neutral-400" />
            </div>
            <div className="space-y-1 max-h-56 overflow-y-auto">
              {searching ? (
                <div className="flex items-center justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-neutral-400" /></div>
              ) : searchResults.length > 0 ? (
                searchResults.map((u) => (
                  <button key={u.id} onClick={() => handleStartConversation(u.id)}
                    className="w-full text-left flex items-center justify-between px-3 py-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer group">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-xl bg-neutral-200 dark:bg-neutral-700 flex items-center justify-center text-xs font-bold text-neutral-700 dark:text-neutral-300 shrink-0">
                        {userLabel(u).charAt(0).toUpperCase()}
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs font-semibold text-neutral-900 dark:text-neutral-100 truncate">{userLabel(u)}</span>
                        {u.displayName && (
                          <span className="text-[10px] text-neutral-400 truncate">{u.studentId}</span>
                        )}
                      </div>
                    </div>
                    {u.section && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 border border-neutral-200/60 dark:border-neutral-700/60">
                        {u.section}
                      </span>
                    )}
                  </button>
                ))
              ) : searchQuery.trim() ? (
                <p className="text-xs text-neutral-400 text-center py-3">No users found</p>
              ) : (
                <p className="text-xs text-neutral-400 text-center py-3">Search any student ID to start chatting</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Lightbox / Media Preview Modal with Liquid Glass */}
      {previewMedia && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-in fade-in duration-200" onClick={() => setPreviewMedia(null)}>
          <div className="relative max-w-3xl w-full max-h-[90vh] bg-white/85 dark:bg-[#121215]/90 border border-white/50 dark:border-white/10 rounded-3xl p-5 flex flex-col items-center justify-center space-y-4 shadow-[0_12px_40px_rgba(0,0,0,0.4)] backdrop-blur-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="w-full flex items-center justify-between border-b border-neutral-200/60 dark:border-white/10 pb-3">
              <span className="text-xs font-semibold text-neutral-900 dark:text-neutral-100 truncate">{previewMedia.name}</span>
              <div className="flex items-center gap-2">
                {!previewMedia.isImage && (
                  <a
                    href={previewMedia.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1 rounded-xl bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 text-[11px] font-semibold shadow-2xs flex items-center gap-1"
                  >
                    <ExternalLink className="w-3 h-3" />
                    <span>Open Full PDF</span>
                  </a>
                )}
                <button onClick={() => setPreviewMedia(null)} className="p-1.5 rounded-full text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors cursor-pointer">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>
            {previewMedia.isImage ? (
              <img src={previewMedia.url} alt={previewMedia.name} className="max-h-[70vh] w-auto max-w-full object-contain rounded-2xl shadow-md" />
            ) : (
              <div className="w-full h-[65vh] rounded-2xl overflow-y-scroll -webkit-overflow-scrolling-touch touch-pan-y overscroll-contain bg-white border border-neutral-200 dark:border-neutral-800 shadow-2xs">
                <iframe src={previewMedia.url} title={previewMedia.name} className="w-full h-full min-h-[60vh] border-0" />
              </div>
            )}
            <a
              href={previewMedia.url}
              download={previewMedia.name}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 text-xs font-semibold hover:opacity-90 transition-opacity shadow-2xs"
            >
              <Download className="w-4 h-4" />
              <span>Download File</span>
            </a>
          </div>
        </div>
      )}
    </div>
  );
};

