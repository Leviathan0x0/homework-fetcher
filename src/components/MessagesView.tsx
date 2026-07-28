import React, { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch, apiUrl } from '../lib/api';
import { messagingService, authService } from '../services/api';
import { compressImage, isCompressibleImage, formatBytes } from '../utils/imageCompression';
import { MAX_UPLOAD_BYTES } from '../lib/api';
import { Conversation, Message } from '../types/homework';
import { cn } from '../utils/cn';
import { MarkdownRenderer } from './MarkdownRenderer';
import { MonitoringNoticeDialog } from './MonitoringNoticeDialog';
import { SearchIcon } from '@/components/ui/search';
import { AttachFileIcon } from '@/components/ui/attach-file';
import { LogoutIcon } from '@/components/ui/logout';
import { MessageSquareIcon } from '@/components/ui/message-square';
import {
  Plus,
  X,
  Loader2,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  Paperclip,
  Eye,
  FileText,
  Download,
  ExternalLink,
  Trash2,
} from 'lucide-react';

interface MessagesViewProps {
  userSection?: string;
}

export const MessagesView: React.FC<MessagesViewProps> = ({ userSection }) => {
  const [hoveredAction, setHoveredAction] = useState<string | null>(null);
  // Seeded from the last load so the inbox paints immediately instead of
  // showing an empty list until the first request comes back.
  const [conversations, setConversations] = useState<Conversation[]>(
    () => messagingService.getCachedConversations() as Conversation[]
  );
  const [isLoading, setIsLoading] = useState(() => messagingService.getCachedConversations().length === 0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [inputText, setInputText] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
  const [deletingConvId, setDeletingConvId] = useState<string | null>(null);
  const [currentStudentId, setCurrentStudentId] = useState<string>(() => sessionStorage.getItem('activeStudentId') || 'Student');
  const [showScrollBottom, setShowScrollBottom] = useState(false);

  // State for monitoring notice dialog
  const [showNoticeDialog, setShowNoticeDialog] = useState(false);
  const [pendingParticipant, setPendingParticipant] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    authService.getCurrentUser().then(u => {
      if (u && u.studentId) {
        setCurrentStudentId(u.studentId);
      }
    });
  }, []);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent('active_conv_changed', { detail: activeConvId }));
  }, [activeConvId]);

  const [previewMedia, setPreviewMedia] = useState<{ url: string; name: string } | null>(null);

  const [showNewModal, setShowNewModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<
    { id: string; studentId: string; displayName?: string | null; name?: string; section?: string }[]
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
    try {
      const convs = await messagingService.getConversations();
      setConversations(convs);
      setLoadError(null);
    } catch {
      setLoadError('Conversations could not be loaded. Retrying…');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConversations();
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') fetchConversations();
    }, 6000);
    return () => clearInterval(interval);
  }, [fetchConversations]);

  useEffect(() => {
    const handleOpenConv = async (e: any) => {
      const targetId = e.detail;
      if (!targetId) return;

      const resolveConv = (list: Conversation[]) => {
        const byConvId = list.find((c) => c.id === targetId);
        if (byConvId) return byConvId.id;
        const byUserId = list.find(
          (c) => c.otherUser?.id === targetId || c.otherUser?.studentId === targetId
        );
        if (byUserId) return byUserId.id;
        return null;
      };

      let resolvedId = resolveConv(conversations);
      if (resolvedId) {
        setActiveConvId(resolvedId);
        return;
      }

      try {
        const freshList = await messagingService.getConversations();
        setConversations(freshList);
        resolvedId = resolveConv(freshList);
        if (resolvedId) {
          setActiveConvId(resolvedId);
          return;
        }
      } catch {}

      // If targetId is a user ID and no conversation exists yet, initiate a new conversation
      const name = targetId.startsWith('usr_') ? 'Student' : targetId;
      setPendingParticipant({ id: targetId, name });
      setShowNoticeDialog(true);
    };

    window.addEventListener('open_conversation', handleOpenConv);
    return () => window.removeEventListener('open_conversation', handleOpenConv);
  }, [conversations]);

  const fetchMessages = useCallback(async (convId: string, silent: boolean = false) => {
    if (!silent) setMessagesLoading(true);
    try {
      const msgs = await messagingService.getMessages(convId);
      setMessages((prev) => {
        // The server list is authoritative, so deleted messages stay deleted.
        // Only locally sent messages the server has not returned yet are kept.
        const map = new Map<string, Message>();
        msgs.forEach((m: Message) => map.set(m.id, m));
        const newestServerAt = msgs.length
          ? new Date(msgs[msgs.length - 1].createdAt).getTime()
          : 0;
        prev.forEach((m) => {
          if (m.conversationId !== convId || map.has(m.id)) return;
          if (new Date(m.createdAt).getTime() > newestServerAt) map.set(m.id, m);
        });
        return Array.from(map.values()).sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
      });
    } catch {} finally {
      if (!silent) setMessagesLoading(false);
    }
  }, [currentStudentId]);

  useEffect(() => {
    if (!activeConvId) return;

    setMessages([]);
    fetchMessages(activeConvId);
    messagingService.markAsRead(activeConvId);
    setConversations((prev) =>
      prev.map((c) => (c.id === activeConvId ? { ...c, unreadCount: 0 } : c))
    );

    const messageInterval = setInterval(() => {
      if (document.visibilityState === 'visible') fetchMessages(activeConvId, true);
    }, 3000);

    return () => {
      clearInterval(messageInterval);
    };
  }, [activeConvId, fetchMessages, currentStudentId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (!previewMedia) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [previewMedia]);

  const handleSend = async () => {
    if ((!inputText.trim() && !selectedFile) || !activeConvId || sending) return;
    setSending(true);

    const textCopy = inputText;
    const fileCopy = selectedFile;

    setInputText('');
    setSelectedFile(null);
    setFileError(null);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    try {
      const sentMessage = await messagingService.sendMessage(
        activeConvId,
        currentStudentId,
        textCopy.trim(),
        fileCopy
      );
      setMessages((prev) => {
        if (prev.some((m) => m.id === sentMessage.id)) return prev;
        return [...prev, sentMessage];
      });
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeConvId
            ? {
                ...c,
                lastMessagePreview: fileCopy ? `[Attachment] ${fileCopy.name}` : textCopy.substring(0, 80),
                lastMessageAt: sentMessage.createdAt,
              }
            : c
        )
      );
    } catch (err: any) {
      // Put the draft back so nothing is silently lost, and say why it failed.
      setInputText(textCopy);
      setSelectedFile(fileCopy);
      setFileError(typeof err?.message === 'string' ? err.message : 'Message could not be sent. Try again.');
    } finally { setSending(false); }
  };

  // Photos are downscaled in the browser: full-size camera images exceed the
  // upload limit and waste everyone's mobile data.
  const handlePickFile = async (file: File) => {
    setFileError(null);
    const prepared = isCompressibleImage(file) ? await compressImage(file) : file;
    if (prepared.size > MAX_UPLOAD_BYTES) {
      setFileError(
        `That file is ${formatBytes(prepared.size)}. Maximum upload size is ${formatBytes(MAX_UPLOAD_BYTES)}.`
      );
      return;
    }
    setSelectedFile(prepared);
  };

  const handleDeleteMessage = async (messageId: string) => {
    if (!confirm('Delete this message for everyone?')) return;
    setDeletingMessageId(messageId);
    try {
      await messagingService.deleteMessage(messageId);
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
      fetchConversations();
    } catch (err: any) {
      setFileError(typeof err?.message === 'string' ? err.message : 'Message could not be deleted.');
    } finally {
      setDeletingMessageId(null);
    }
  };

  const handleDeleteConversation = async (convId: string) => {
    if (!confirm('Delete this conversation and all of its messages?')) return;
    setDeletingConvId(convId);
    try {
      await messagingService.deleteConversation(convId);
      setConversations((prev) => prev.filter((c) => c.id !== convId));
      if (activeConvId === convId) {
        setActiveConvId(null);
        setMessages([]);
      }
    } catch (err: any) {
      setLoadError(typeof err?.message === 'string' ? err.message : 'Conversation could not be deleted.');
    } finally {
      setDeletingConvId(null);
    }
  };

  const handleSearch = async (q: string) => {
    setSearchQuery(q);
    if (!q.trim()) { setSearchResults([]); return; }
    setSearching(true);
    try {
      const results = await messagingService.searchUsers(q, currentStudentId);
      setSearchResults(results);
    } catch {} finally { setSearching(false); }
  };

  const handleInitiateChat = (u: { id: string; studentId: string; displayName?: string | null }) => {
    const name = u.displayName || u.studentId;
    const existing = conversations.find(c => c.otherUser?.id === u.id);
    if (existing) {
      setShowNewModal(false);
      setSearchQuery('');
      setSearchResults([]);
      setActiveConvId(existing.id);
    } else {
      setPendingParticipant({ id: u.id, name });
      setShowNoticeDialog(true);
    }
  };

  const handleConfirmNotice = async (noticeToken: string) => {
    if (!pendingParticipant) return;
    const participantId = pendingParticipant.id;
    setShowNoticeDialog(false);
    setPendingParticipant(null);
    await handleStartConversation(participantId, noticeToken);
  };

  const handleStartConversation = async (participantId: string, noticeToken: string) => {
    try {
      const data = await messagingService.startConversation(currentStudentId, participantId, noticeToken);
      setShowNewModal(false);
      setSearchQuery('');
      setSearchResults([]);
      setActiveConvId(data.conversationId);
      setConversations((prev) => {
        if (prev.some((c) => c.id === data.conversationId)) return prev;
        return [
          {
            id: data.conversationId,
            otherUser: data.otherUser,
            unreadCount: 0,
            lastMessagePreview: 'Started a new conversation',
            lastMessageAt: new Date().toISOString(),
          },
          ...prev,
        ];
      });
    } catch (err: any) {
      alert(err.message || 'Failed to start conversation.');
    }
  };

  const activeConv = conversations.find((c) => c.id === activeConvId);
  const otherName = activeConv ? userLabel(activeConv.otherUser) : 'Conversation';
  const otherSection = activeConv?.otherUser?.section;

  const inboxContent = (
    <div className="h-full flex flex-col bg-neutral-50/80 dark:bg-[#121215]">
      {/* Header bar with inline search */}
      <div className="p-3 border-b border-neutral-200/80 dark:border-neutral-800/80 shrink-0 space-y-2">
        <div className="flex items-center justify-between px-1">
          <span className="text-xs font-semibold text-neutral-500 dark:text-neutral-400">Messages</span>
        </div>
        <div className="relative">
          <SearchIcon size={14} isAnimated={Boolean(searchQuery)} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search student ID..."
            className="w-full text-xs h-8.5 pl-8 pr-7 rounded-xl border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-1 focus:ring-neutral-400"
          />
          {searchQuery && (
            <button
              onClick={() => { setSearchQuery(''); setSearchResults([]); }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Main List: Search Results or Active Conversations */}
      <div className="flex-1 overflow-y-auto divide-y divide-neutral-200/40 dark:divide-neutral-800/40">
        {searching ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-4 h-4 animate-spin text-neutral-400" />
          </div>
        ) : searchQuery.trim() ? (
          searchResults.length > 0 ? (
            searchResults.map((u) => (
              <button
                key={u.id}
                onClick={() => handleInitiateChat(u)}
                className="w-full text-left px-3.5 py-3 flex items-center gap-3 transition-all cursor-pointer hover:bg-neutral-200/40 dark:hover:bg-neutral-800/40"
              >
                <div className="w-9 h-9 rounded-xl bg-neutral-300 dark:bg-neutral-700 text-neutral-900 dark:text-neutral-100 flex items-center justify-center text-xs font-bold shrink-0">
                  {u.studentId.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-neutral-900 dark:text-neutral-100 truncate">
                      {u.studentId}
                    </span>
                    {u.section && (
                      <span className="px-1.5 py-0.2 rounded text-[9px] font-medium bg-neutral-200/70 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 shrink-0">
                        {u.section}
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400 truncate mt-0.5">Click to start conversation</p>
                </div>
              </button>
            ))
          ) : (
            <div className="p-6 text-center text-xs text-neutral-400">No users found</div>
          )
        ) : conversations.length === 0 ? (
          isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-4 h-4 animate-spin text-neutral-400" />
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center my-auto min-h-[200px]">
              <div className="w-10 h-10 rounded-2xl bg-neutral-200/60 dark:bg-neutral-800 flex items-center justify-center text-neutral-400 mb-2">
                <MessageSquareIcon size={20} />
              </div>
              <p className="text-xs text-neutral-500 font-medium">
                {loadError ? 'Conversations unavailable' : 'No active conversations'}
              </p>
              <p className="text-[11px] text-neutral-400 mt-1">
                {loadError || 'Search for a student ID above to start chatting'}
              </p>
            </div>
          )
        ) : (
          conversations.map((conv) => (
            <div
              key={conv.id}
              className={cn(
                'flex items-center gap-1 pr-2 transition-all hover:bg-neutral-200/40 dark:hover:bg-neutral-800/40 group/conv',
                activeConvId === conv.id && 'bg-neutral-200/80 dark:bg-neutral-800/80 font-medium'
              )}
            >
              <button
                onClick={() => setActiveConvId(conv.id)}
                className="flex-1 min-w-0 text-left pl-3.5 pr-1 py-3 flex items-center gap-3 cursor-pointer"
              >
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
              <button
                onClick={() => handleDeleteConversation(conv.id)}
                disabled={deletingConvId === conv.id}
                title="Delete conversation"
                aria-label="Delete conversation"
                className="p-1.5 rounded-lg text-neutral-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer shrink-0 disabled:opacity-50 md:opacity-0 md:group-hover/conv:opacity-100 md:focus-visible:opacity-100"
              >
                {deletingConvId === conv.id ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          ))
        )}
      </div>
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

        <button
          onClick={() => activeConvId && handleDeleteConversation(activeConvId)}
          disabled={!activeConvId || deletingConvId === activeConvId}
          title="Delete conversation"
          aria-label="Delete conversation"
          className="p-1.5 rounded-lg text-neutral-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer shrink-0 disabled:opacity-50"
        >
          {deletingConvId === activeConvId ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Trash2 className="w-4 h-4" />
          )}
        </button>
      </div>

      {/* Messages Scroll View */}
      <div
        onScroll={(e) => {
          const el = e.currentTarget;
          const isFarFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight > 120;
          setShowScrollBottom(isFarFromBottom);
        }}
        className="flex-1 overflow-y-auto p-4 space-y-3 bg-neutral-50/30 dark:bg-[#09090b] relative"
      >
        {messagesLoading ? (
          <div className="flex items-center justify-center py-8"><Loader2 className="w-4 h-4 animate-spin text-neutral-400" /></div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-xs text-neutral-400">
            No messages yet. Send a message to start conversation!
          </div>
        ) : (
          messages.map((m) => {
            const isMine = Boolean(m.isMine);
            const isImage = m.mimeType?.startsWith('image/') || m.attachmentUrl?.match(/\.(jpg|jpeg|png|webp|gif)$/i);
            const timeStr = new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

            return (
              <div key={m.id} className={cn('flex w-full', isMine ? 'justify-end' : 'justify-start')}>
                <div className={cn(
                  'max-w-[75%] sm:max-w-[65%] p-3 rounded-2xl text-xs shadow-2xs relative group',
                  isMine
                    ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 rounded-tr-xs'
                    : 'bg-neutral-200/80 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100 rounded-tl-xs'
                )}>
                  {isMine && (
                    <button
                      onClick={() => handleDeleteMessage(m.id)}
                      disabled={deletingMessageId === m.id}
                      title="Delete message"
                      aria-label="Delete message"
                      className="absolute -left-7 top-1/2 -translate-y-1/2 p-1 rounded-full text-neutral-400 hover:text-rose-600 dark:hover:text-rose-400 transition-opacity cursor-pointer disabled:opacity-50 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
                    >
                      {deletingMessageId === m.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                  {/* Attachment Box with Preview */}
                  {m.attachmentUrl && (
                    <div className="mb-2 rounded-xl overflow-hidden border border-black/10 dark:border-white/10 bg-black/5 dark:bg-black/20 p-2 space-y-1.5">
                      {isImage ? (
                        <div
                          onClick={() => setPreviewMedia({ url: m.attachmentUrl!, name: m.originalFilename || 'Image' })}
                          className="relative group/img overflow-hidden rounded-lg max-h-48 bg-neutral-900/10 cursor-pointer active:opacity-90 transition-opacity"
                        >
                          <img
                            src={m.attachmentUrl}
                            alt={m.originalFilename || 'Attachment'}
                            className="w-full h-auto object-cover max-h-48 rounded-lg"
                          />
                          <div className="absolute inset-0 bg-black/40 opacity-0 group-hover/img:opacity-100 transition-opacity flex items-center justify-center gap-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setPreviewMedia({ url: m.attachmentUrl!, name: m.originalFilename || 'Image' });
                              }}
                              className="p-1.5 rounded-full bg-white/90 text-neutral-900 hover:scale-105 transition-transform cursor-pointer"
                              title="Preview photo in-app"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            <a
                              href={m.attachmentUrl}
                              download={m.originalFilename || 'photo'}
                              onClick={(e) => e.stopPropagation()}
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
                          <a
                            href={m.attachmentUrl}
                            download={m.originalFilename || 'file'}
                            className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold hover:bg-black/10 dark:hover:bg-white/10 transition-colors cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" />
                            <span>Download</span>
                          </a>
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
                      'text-[9px] shrink-0 font-medium self-end opacity-60 ml-2 mb-0.5',
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

        {/* Scroll to Bottom Button */}
        {showScrollBottom && (
          <button
            onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })}
            aria-label="Scroll to bottom"
            title="Scroll to bottom"
            className="sticky bottom-2 right-2 ml-auto z-30 p-2.5 rounded-full bg-neutral-200/90 text-neutral-700 hover:text-neutral-900 dark:bg-neutral-800/90 dark:text-neutral-300 dark:hover:text-white shadow-md border border-neutral-300/80 dark:border-neutral-700/80 backdrop-blur-md hover:scale-105 active:scale-95 transition-all duration-200 cursor-pointer flex items-center justify-center animate-in fade-in zoom-in-90"
          >
            <ArrowDown className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Input bar with auto-expanding textarea & Shift+Enter support */}
      <div className="p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pb-3 border-t border-neutral-200/80 dark:border-neutral-800/80 shrink-0 bg-white dark:bg-[#121215] z-20">
        {fileError && (
          <div className="mb-2 px-2 text-[11px] text-rose-600 dark:text-rose-400">{fileError}</div>
        )}

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
            onChange={(e) => {
              const picked = e.target.files?.[0];
              if (picked) handlePickFile(picked);
              e.target.value = '';
            }}
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            onMouseEnter={() => setHoveredAction('attach')}
            onMouseLeave={() => setHoveredAction(null)}
            className="p-2 rounded-xl text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer mb-0.5"
            title="Attach photo or document"
          >
            <AttachFileIcon size={18} isAnimated={hoveredAction === 'attach'} />
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
            <MessageSquareIcon size={32} className="opacity-20 text-neutral-400" />
            <span>Select a conversation to view messages</span>
          </div>
        )}
      </div>

      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
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
                  <button key={u.id} onClick={() => handleInitiateChat(u)}
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

      {/* Image lightbox. Only images are previewed in-app: any other attachment
          would have to be rendered as a document on this origin, which would let
          the sender run code in the viewer's session. */}
      {previewMedia && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] bg-black/75 backdrop-blur-md animate-in fade-in duration-200" onClick={() => setPreviewMedia(null)}>
          <div className="relative max-w-3xl w-full max-h-[90vh] bg-white/85 dark:bg-[#121215]/90 border border-white/50 dark:border-white/10 rounded-3xl p-5 flex flex-col items-center justify-center space-y-4 shadow-[0_12px_40px_rgba(0,0,0,0.4)] backdrop-blur-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="w-full flex items-center justify-between border-b border-neutral-200/60 dark:border-white/10 pb-3">
              <span className="text-xs font-semibold text-neutral-900 dark:text-neutral-100 truncate">{previewMedia.name}</span>
              <button onClick={() => setPreviewMedia(null)} className="p-1.5 rounded-full text-neutral-400 hover:text-neutral-900 dark:hover:text-white transition-colors cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <img src={previewMedia.url} alt={previewMedia.name} className="max-h-[70vh] w-auto max-w-full object-contain rounded-2xl shadow-md" />
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

      {/* Monitoring Notice Dialog */}
      <MonitoringNoticeDialog
        isOpen={showNoticeDialog}
        participantId={pendingParticipant?.id || ''}
        participantName={pendingParticipant?.name}
        onConfirm={handleConfirmNotice}
        onCancel={() => {
          setShowNoticeDialog(false);
          setPendingParticipant(null);
        }}
      />
    </div>
  );
};

