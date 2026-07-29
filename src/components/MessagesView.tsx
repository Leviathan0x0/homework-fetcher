import React, { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch, apiUrl } from '../lib/api';
import { messagingService, homeworkService } from '../services/api';
import { compressImage, isCompressibleImage, formatBytes } from '../utils/imageCompression';
import { MAX_UPLOAD_BYTES } from '../lib/api';
import { friendlyContentError } from '../utils/friendlyErrors';
import { Conversation, Message, HomeworkEntry, PinnedHomework } from '../types/homework';
import { cn } from '../utils/cn';
import {
  formatChatDayLabel,
  formatChatListTime,
  sameCalendarDay,
} from '../utils/dateUtils';
import { MarkdownRenderer } from './MarkdownRenderer';
import { MonitoringNoticeDialog } from './MonitoringNoticeDialog';
import { SearchIcon } from '@/components/ui/search';
import { AttachFileIcon } from '@/components/ui/attach-file';
import { MessageSquareIcon } from '@/components/ui/message-square';
import {
  clearPendingMessageOpen,
  peekPendingMessageOpen,
  type PendingRequestContext,
} from '../utils/pendingMessageOpen';
import {
  X,
  Loader2,
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  Paperclip,
  FileText,
  Download,
  Trash2,
  Flag,
  Handshake,
  Reply,
  Check,
  CheckCheck,
  BellOff,
  Bell,
  Pin,
  Users,
} from 'lucide-react';

interface MessagesViewProps {
  userSection?: string;
  studentId?: string;
}

export const MessagesView: React.FC<MessagesViewProps> = ({ userSection, studentId }) => {
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
  const [attachedRequest, setAttachedRequest] = useState<PendingRequestContext | null>(null);
  const pendingPrefillRef = useRef<string | null>(null);
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
  const [deletingConvId, setDeletingConvId] = useState<string | null>(null);
  const [reportingConv, setReportingConv] = useState(false);
  const currentStudentId = studentId || sessionStorage.getItem('activeStudentId') || 'Student';
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [showPinPicker, setShowPinPicker] = useState(false);
  const [pinCandidates, setPinCandidates] = useState<HomeworkEntry[]>([]);
  const [pinLoading, setPinLoading] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [muting, setMuting] = useState(false);
  const [askClassBusy, setAskClassBusy] = useState(false);

  // State for monitoring notice dialog
  const [showNoticeDialog, setShowNoticeDialog] = useState(false);
  const [pendingParticipant, setPendingParticipant] = useState<{ id: string; name: string } | null>(null);

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
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottomRef = useRef(true);
  const searchTimerRef = useRef<number | null>(null);
  const messagesFpRef = useRef('');
  const conversationsFpRef = useRef('');
  const conversationsInFlightRef = useRef(false);
  const messagesInFlightRef = useRef(new Set<string>());
  const activeConvIdRef = useRef(activeConvId);
  const lastReadMessageRef = useRef(new Map<string, string>());
  const markingReadRef = useRef(new Set<string>());
  const failedSendRef = useRef<{ id: string; fingerprint: string } | null>(null);
  activeConvIdRef.current = activeConvId;

  const userLabel = (u?: { displayName?: string | null; studentId?: string } | null) =>
    u?.displayName || u?.studentId || 'Unknown';

  const isMobileDevice = () => {
    if (typeof window === 'undefined') return false;
    return ('ontouchstart' in window || navigator.maxTouchPoints > 0) && window.innerWidth < 768;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter') {
      if (isMobileDevice()) {
        return;
      }
      if (!e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    }
  };

  const fetchConversations = useCallback(async () => {
    if (conversationsInFlightRef.current) return;
    conversationsInFlightRef.current = true;
    try {
      const convs = (await messagingService.getConversations()) as Conversation[];
      const fp = convs
        .map(
          (c: Conversation) =>
            `${c.id}:${c.unreadCount || 0}:${c.lastMessageAt || ''}:${c.lastMessagePreview || ''}:${c.muted ? 1 : 0}:${c.pinnedHomeworkId || ''}`
        )
        .join('|');
      if (fp !== conversationsFpRef.current) {
        conversationsFpRef.current = fp;
        setConversations(convs);
      }
      setLoadError(null);
    } catch {
      setLoadError('Conversations could not be loaded. Retrying…');
    } finally {
      conversationsInFlightRef.current = false;
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConversations();
    // Inbox list can refresh more slowly — active thread has its own poller.
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') fetchConversations();
    }, 12000);
    return () => clearInterval(interval);
  }, [fetchConversations]);

  const helpDialogShownRef = useRef(false);
  const helpProcessedKeyRef = useRef<string | null>(null);
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;

  const applyHelpContext = useCallback((prefill?: string, request?: PendingRequestContext | null) => {
    if (request && request.id && request.title) {
      setAttachedRequest(request);
    }
    const text = prefill?.trim();
    if (text) {
      pendingPrefillRef.current = text;
      setInputText(text);
    }
  }, []);

  const resolveConvId = useCallback((list: Conversation[], targetId: string) => {
    const byConvId = list.find((c) => c.id === targetId);
    if (byConvId) return byConvId.id;
    const byUserId = list.find(
      (c) => c.otherUser?.id === targetId || c.otherUser?.studentId === targetId
    );
    if (byUserId) return byUserId.id;
    return null;
  }, []);

  const openHelpTarget = useCallback(
    (targetId: string, prefill?: string, request?: PendingRequestContext | null) => {
      applyHelpContext(prefill, request);

      const resolvedId = resolveConvId(conversationsRef.current, targetId);
      if (resolvedId) {
        helpDialogShownRef.current = false;
        setShowNoticeDialog(false);
        setPendingParticipant(null);
        setActiveConvId(resolvedId);
        return;
      }

      if (helpDialogShownRef.current) return;
      helpDialogShownRef.current = true;
      const name = targetId.startsWith('usr_') ? 'Student' : targetId;
      setPendingParticipant({ id: targetId, name });
      setShowNoticeDialog(true);
    },
    [applyHelpContext, resolveConvId]
  );

  // Stable listener for Help / notification deep-links (uses conversationsRef).
  useEffect(() => {
    const handleOpenConv = (e: Event) => {
      const raw = (e as CustomEvent).detail;

      // Notification / deep-link: open an existing conversation by id.
      const conversationId =
        typeof raw === 'string'
          ? null
          : raw && typeof raw === 'object' && typeof raw.conversationId === 'string'
            ? raw.conversationId
            : null;
      if (conversationId) {
        setAttachedRequest(null);
        setActiveConvId(conversationId);
        clearPendingMessageOpen();
        return;
      }

      // Bare string may be either a conversation id or a user/student id.
      if (typeof raw === 'string' && raw) {
        const existing = conversationsRef.current.find((c) => c.id === raw);
        if (existing) {
          setAttachedRequest(null);
          setActiveConvId(raw);
          clearPendingMessageOpen();
          return;
        }
      }

      const targetId =
        typeof raw === 'string'
          ? raw
          : raw && typeof raw === 'object'
            ? String(raw.targetId || raw.id || '')
            : '';
      const prefill =
        raw && typeof raw === 'object' && typeof raw.prefill === 'string'
          ? raw.prefill.trim()
          : '';
      const request =
        raw && typeof raw === 'object' && raw.request && typeof raw.request === 'object'
          ? (raw.request as PendingRequestContext)
          : null;
      if (!targetId) {
        applyHelpContext(prefill || undefined, request);
        return;
      }
      const key = `${targetId}:${request?.id || prefill || ''}`;
      helpProcessedKeyRef.current = key;
      openHelpTarget(targetId, prefill || undefined, request);
    };

    window.addEventListener('open_conversation', handleOpenConv);
    return () => window.removeEventListener('open_conversation', handleOpenConv);
  }, [applyHelpContext, openHelpTarget]);

  // One-shot sessionStorage handoff from Requests → Messages or notification taps.
  useEffect(() => {
    const pending = peekPendingMessageOpen();
    if (!pending) return;

    if (pending.conversationId) {
      setAttachedRequest(null);
      setActiveConvId(pending.conversationId);
      clearPendingMessageOpen();
      return;
    }

    if (!pending.targetId) return;
    const key = `${pending.targetId}:${pending.request?.id || pending.prefill || ''}`;
    if (helpProcessedKeyRef.current === key) return;
    helpProcessedKeyRef.current = key;
    openHelpTarget(pending.targetId, pending.prefill, pending.request ?? null);
  }, [openHelpTarget]);

  // If Help opened the notice dialog before conversations loaded, resolve once they arrive.
  useEffect(() => {
    const pending = peekPendingMessageOpen();
    if (!pending?.targetId) return;
    const resolvedId = resolveConvId(conversations, pending.targetId);
    if (!resolvedId) return;

    helpDialogShownRef.current = false;
    setShowNoticeDialog(false);
    setPendingParticipant(null);
    applyHelpContext(pending.prefill, pending.request ?? null);

    if (activeConvId !== resolvedId) {
      setActiveConvId(resolvedId);
    } else {
      clearPendingMessageOpen();
    }
  }, [conversations, activeConvId, resolveConvId, applyHelpContext]);

  useEffect(() => {
    if (!activeConvId) return;
    if (pendingPrefillRef.current) {
      const text = pendingPrefillRef.current;
      pendingPrefillRef.current = null;
      setInputText(text);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.style.height = 'auto';
          el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
          el.focus();
        }
      });
    }
    if (peekPendingMessageOpen()) clearPendingMessageOpen();
  }, [activeConvId]);

  const fetchMessages = useCallback(async (convId: string, silent: boolean = false) => {
    if (messagesInFlightRef.current.has(convId)) return;
    messagesInFlightRef.current.add(convId);
    if (!silent) setMessagesLoading(true);
    try {
      const msgs = (await messagingService.getMessages(convId)) as Message[];
      if (activeConvIdRef.current !== convId) return;
      const latestIncoming = [...msgs].reverse().find((message) => !message.isMine);
      if (
        latestIncoming &&
        lastReadMessageRef.current.get(convId) !== latestIncoming.id &&
        !markingReadRef.current.has(convId)
      ) {
        markingReadRef.current.add(convId);
        void messagingService
          .markAsRead(convId)
          .then(() => {
            lastReadMessageRef.current.set(convId, latestIncoming.id);
            window.dispatchEvent(new CustomEvent('messages_unread_changed'));
          })
          .catch(() => {})
          .finally(() => {
            markingReadRef.current.delete(convId);
          });
      }
      const fp = msgs.map((m: Message) => `${m.id}:${(m.readBy || []).length}`).join(',');
      setMessages((prev) => {
        const map = new Map<string, Message>();
        msgs.forEach((m: Message) => map.set(m.id, m));
        const newestServerAt = msgs.length
          ? new Date(msgs[msgs.length - 1].createdAt).getTime()
          : 0;
        // Keep optimistic temps + any local-only sends the poll hasn't returned yet.
        prev.forEach((m) => {
          if (m.conversationId !== convId || map.has(m.id)) return;
          if (String(m.id).startsWith('temp_')) {
            map.set(m.id, m);
            return;
          }
          if (new Date(m.createdAt).getTime() > newestServerAt) map.set(m.id, m);
        });
        const next = Array.from(map.values()).sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
        const nextFp = next.map((m) => `${m.id}:${(m.readBy || []).length}`).join(',');
        if (silent && nextFp === messagesFpRef.current) return prev;
        messagesFpRef.current = nextFp;
        return next;
      });
    } catch {
      // keep showing whatever we already have
    } finally {
      messagesInFlightRef.current.delete(convId);
      if (!silent) setMessagesLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!activeConvId) return;

    stickToBottomRef.current = true;
    messagesFpRef.current = '';
    setMessagesLoading(true);
    fetchMessages(activeConvId);
    setConversations((prev) =>
      prev.map((c) => (c.id === activeConvId ? { ...c, unreadCount: 0 } : c))
    );

    const messageInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchMessages(activeConvId, true);
      }
    }, 5000);

    return () => {
      clearInterval(messageInterval);
    };
  }, [activeConvId, fetchMessages]);

  useEffect(() => {
    if (!stickToBottomRef.current) return;
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
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

    const textCopy = inputText;
    const fileCopy = selectedFile;
    const replyToCopy = replyingTo;
    const sendFingerprint = [
      activeConvId,
      textCopy.trim(),
      fileCopy ? `${fileCopy.name}:${fileCopy.size}:${fileCopy.lastModified}` : '',
      replyToCopy?.id || '',
    ].join('\u0000');
    const failedSend = failedSendRef.current;
    const clientMessageId =
      failedSend?.fingerprint === sendFingerprint
        ? failedSend.id
        : crypto.randomUUID();
    if (failedSend?.id !== clientMessageId) {
      failedSendRef.current = null;
    }
    const tempId = `temp_${clientMessageId}`;
    const optimistic: Message = {
      id: tempId,
      conversationId: activeConvId,
      senderId: 'local',
      content: textCopy.trim(),
      attachmentUrl: fileCopy && fileCopy.type.startsWith('image/')
        ? URL.createObjectURL(fileCopy)
        : null,
      originalFilename: fileCopy?.name || null,
      mimeType: fileCopy?.type || null,
      replyTo: replyToCopy ? {
        id: replyToCopy.id,
        senderId: replyToCopy.senderId,
        senderName: replyToCopy.senderName,
        content: replyToCopy.content.substring(0, 100),
        attachmentUrl: replyToCopy.attachmentUrl,
      } : null,
      readBy: [],
      createdAt: new Date().toISOString(),
      isMine: true,
    };

    setSending(true);
    setInputText('');
    setSelectedFile(null);
    setReplyingTo(null);
    setFileError(null);
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    stickToBottomRef.current = true;
    setMessages((prev) => [...prev, optimistic]);
    setConversations((prev) =>
      prev.map((c) =>
        c.id === activeConvId
          ? {
              ...c,
              lastMessagePreview: fileCopy
                ? `[Attachment] ${fileCopy.name}`
                : textCopy.substring(0, 80),
              lastMessageAt: optimistic.createdAt,
            }
          : c
      )
    );

    try {
      const sentMessage = await messagingService.sendMessage(
        activeConvId,
        currentStudentId,
        textCopy.trim(),
        fileCopy,
        replyToCopy?.id || null,
        clientMessageId
      );
      failedSendRef.current = null;
      if (optimistic.attachmentUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(optimistic.attachmentUrl);
      }
      setMessages((prev) => {
        const withoutTemp = prev.filter((m) => m.id !== tempId);
        if (withoutTemp.some((m) => m.id === sentMessage.id)) return withoutTemp;
        return [...withoutTemp, sentMessage];
      });
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeConvId
            ? {
                ...c,
                lastMessagePreview: fileCopy
                  ? `[Attachment] ${fileCopy.name}`
                  : textCopy.substring(0, 80),
                lastMessageAt: sentMessage.createdAt,
              }
            : c
        )
      );
    } catch (err: any) {
      failedSendRef.current = { id: clientMessageId, fingerprint: sendFingerprint };
      if (optimistic.attachmentUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(optimistic.attachmentUrl);
      }
      setMessages((prev) => prev.filter((m) => m.id !== tempId));
      setInputText(textCopy);
      setSelectedFile(fileCopy);
      setReplyingTo(replyToCopy);
      setFileError(friendlyContentError(err, 'Message could not be sent. Try again.'));
    } finally {
      setSending(false);
    }
  };

  // Photos are downscaled in the browser: full-size camera images exceed the
  // upload limit and waste everyone's mobile data.
  const handlePickFile = async (file: File) => {
    setFileError(null);
    const ext = file.name.includes('.') ? `.${file.name.split('.').pop()!.toLowerCase()}` : '';
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.pdf'];
    if (!allowed.includes(ext)) {
      setFileError('Only homework PDFs and photos (JPG, PNG, or WebP) can be shared here.');
      return;
    }
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
    const target = conversations.find((c) => c.id === convId);
    if (target?.type === 'section') {
      alert('Ask Class is shared with your whole section and can’t be deleted. Mute it if you don’t want notifications.');
      return;
    }
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

  const handleReportConversation = async () => {
    if (!activeConvId || reportingConv) return;
    const ok = confirm(
      'Report this chat to school staff?\n\nUse this only for serious issues (abuse, harassment, or unsafe behaviour).'
    );
    if (!ok) return;
    setReportingConv(true);
    try {
      const data = await messagingService.reportConversation(activeConvId);
      setFileError(null);
      alert(typeof data?.message === 'string' ? data.message : 'Thanks — this chat was reported for school review.');
    } catch (err: any) {
      setFileError(friendlyContentError(err, 'Could not submit the report. Please try again.'));
    } finally {
      setReportingConv(false);
    }
  };

  const handleToggleMute = async () => {
    if (!activeConvId || muting) return;
    const conv = conversations.find((c) => c.id === activeConvId);
    if (!conv) return;
    const nextMuted = !conv.muted;
    setMuting(true);
    setConversations((prev) =>
      prev.map((c) => (c.id === activeConvId ? { ...c, muted: nextMuted } : c))
    );
    try {
      await messagingService.muteConversation(activeConvId, nextMuted);
    } catch (err: any) {
      setConversations((prev) =>
        prev.map((c) => (c.id === activeConvId ? { ...c, muted: !nextMuted } : c))
      );
      setFileError(friendlyContentError(err, 'Could not update mute.'));
    } finally {
      setMuting(false);
    }
  };

  const openPinPicker = async () => {
    if (!activeConvId) return;
    setShowPinPicker(true);
    setPinLoading(true);
    try {
      const list = await homeworkService.getHomework(currentStudentId);
      const withFiles = (list || []).filter((h: HomeworkEntry) => Boolean(h.attachment));
      setPinCandidates(withFiles);
    } catch {
      setPinCandidates([]);
    } finally {
      setPinLoading(false);
    }
  };

  const handlePinHomework = async (homeworkId: string | null) => {
    if (!activeConvId || pinning) return;
    setPinning(true);
    try {
      const result = await messagingService.pinHomework(activeConvId, homeworkId);
      setConversations((prev) =>
        prev.map((c) =>
          c.id === activeConvId
            ? {
                ...c,
                pinnedHomeworkId: result.pinnedHomeworkId,
                pinnedHomework: result.pinnedHomework as PinnedHomework | null,
              }
            : c
        )
      );
      setShowPinPicker(false);
    } catch (err: any) {
      setFileError(friendlyContentError(err, 'Could not update pinned homework.'));
    } finally {
      setPinning(false);
    }
  };

  const handleAskClass = async () => {
    if (askClassBusy) return;
    setAskClassBusy(true);
    try {
      const result = await messagingService.createSectionConversation();
      await fetchConversations();
      setActiveConvId(result.conversationId);
      setAttachedRequest(null);
    } catch (err: any) {
      alert(err.message || 'Failed to open Ask Class.');
    } finally {
      setAskClassBusy(false);
    }
  };

  const handleSearch = (q: string) => {
    setSearchQuery(q);
    if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current);
    if (!q.trim()) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimerRef.current = window.setTimeout(async () => {
      try {
        const results = await messagingService.searchUsers(q, currentStudentId);
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 280);
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
    helpDialogShownRef.current = false;
    setShowNoticeDialog(false);
    setPendingParticipant(null);

    const existingConv = conversations.find(
      (c) => c.otherUser?.id === participantId || c.otherUser?.studentId === participantId
    );
    if (existingConv) {
      setActiveConvId(existingConv.id);
    }
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
  const otherName = activeConv
    ? activeConv.type === 'section'
      ? `Ask ${activeConv.section || 'Class'}`
      : userLabel(activeConv.otherUser)
    : 'Conversation';
  const otherSection = activeConv?.type === 'section' ? null : activeConv?.otherUser?.section;

  const inboxContent = (
    <div className="h-full flex flex-col bg-[#f7f7f8] dark:bg-[#0c0c0e]">
      <div className="px-4 pt-4 pb-3 border-b border-neutral-200/70 dark:border-neutral-800/70 shrink-0 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
            Messages
          </h2>
          <div className="flex items-center gap-2">
            {conversations.length > 0 && !searchQuery && (
              <span className="text-[11px] tabular-nums text-neutral-400">
                {conversations.length}
              </span>
            )}
            <button
              onClick={handleAskClass}
              disabled={askClassBusy}
              title="Ask your class"
              aria-label="Ask your class"
              className="p-1.5 rounded-lg text-neutral-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-colors cursor-pointer disabled:opacity-50"
            >
              {askClassBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
            </button>
          </div>
        </div>
        <div className="relative">
          <SearchIcon
            size={14}
            isAnimated={Boolean(searchQuery)}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Find by name or student ID"
            className="w-full text-[13px] h-9 pl-9 pr-8 rounded-lg border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-[#141417] text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none focus:border-neutral-400 dark:focus:border-neutral-600"
          />
          {searchQuery && (
            <button
              onClick={() => {
                handleSearch('');
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-200 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {searching ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="w-4 h-4 animate-spin text-neutral-400" />
          </div>
        ) : searchQuery.trim() ? (
          searchResults.length > 0 ? (
            searchResults.map((u) => (
              <button
                key={u.id}
                onClick={() => handleInitiateChat(u)}
                className="w-full text-left px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-neutral-200/50 dark:hover:bg-white/[0.03] transition-colors"
              >
                <div className="w-10 h-10 rounded-full bg-neutral-200 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 flex items-center justify-center text-[13px] font-semibold shrink-0">
                  {(u.displayName || u.studentId).charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-neutral-900 dark:text-neutral-100 truncate">
                    {u.displayName || u.studentId}
                  </p>
                  <p className="text-[11px] text-neutral-500 truncate mt-0.5">
                    {u.displayName ? u.studentId : 'Start a conversation'}
                    {u.section ? ` · ${u.section}` : ''}
                  </p>
                </div>
              </button>
            ))
          ) : (
            <p className="px-4 py-10 text-center text-[12px] text-neutral-400">No students matched.</p>
          )
        ) : conversations.length === 0 ? (
          isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="w-4 h-4 animate-spin text-neutral-400" />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center px-8 py-16 text-center">
              <MessageSquareIcon size={22} className="text-neutral-300 dark:text-neutral-600 mb-3" />
              <p className="text-[13px] font-medium text-neutral-600 dark:text-neutral-300">
                {loadError ? 'Couldn’t load chats' : 'No conversations yet'}
              </p>
              <p className="text-[12px] text-neutral-400 mt-1.5 max-w-[18rem] leading-relaxed">
                {loadError || 'Search a classmate’s student ID above to message them.'}
              </p>
            </div>
          )
        ) : (
          conversations.map((conv) => {
            const active = activeConvId === conv.id;
            const unread = (conv.unreadCount || 0) > 0;
            return (
              <div
                key={conv.id}
                className={cn(
                  'flex items-stretch group/conv border-l-2',
                  active
                    ? 'bg-white dark:bg-[#141417] border-l-neutral-900 dark:border-l-neutral-100'
                    : 'border-l-transparent hover:bg-white/70 dark:hover:bg-white/[0.03]'
                )}
              >
                <button
                  onClick={() => {
                    setAttachedRequest(null);
                    setActiveConvId(conv.id);
                  }}
                  className="flex-1 min-w-0 text-left px-4 py-3 flex items-center gap-3 cursor-pointer"
                >
                  <div
                    className={cn(
                      'w-10 h-10 rounded-full flex items-center justify-center text-[13px] font-semibold shrink-0',
                      unread
                        ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                        : 'bg-neutral-200 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200'
                    )}
                  >
                    {conv.type === 'section' ? (
                      <Users className="w-5 h-5" />
                    ) : (
                      userLabel(conv.otherUser).charAt(0).toUpperCase()
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span
                          className={cn(
                            'text-[13px] truncate',
                            unread
                              ? 'font-semibold text-neutral-900 dark:text-neutral-50'
                              : 'font-medium text-neutral-800 dark:text-neutral-200'
                          )}
                        >
                          {conv.type === 'section' ? `Ask ${conv.section || 'Class'}` : userLabel(conv.otherUser)}
                        </span>
                        {conv.muted && (
                          <BellOff className="w-3 h-3 text-neutral-400 shrink-0" />
                        )}
                      </div>
                      {conv.lastMessageAt && (
                        <span className="text-[10px] text-neutral-400 shrink-0 tabular-nums">
                          {formatChatListTime(conv.lastMessageAt)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <p
                        className={cn(
                          'text-[12px] truncate flex-1',
                          unread
                            ? 'text-neutral-700 dark:text-neutral-300'
                            : 'text-neutral-500 dark:text-neutral-500'
                        )}
                      >
                        {conv.lastMessagePreview || 'No messages yet'}
                      </p>
                      {conv.otherUser?.section && (
                        <span className="text-[10px] text-neutral-400 shrink-0">
                          {conv.otherUser.section}
                        </span>
                      )}
                      {unread && (
                        <span className="min-w-[1.1rem] h-[1.1rem] px-1 rounded-full bg-neutral-900 dark:bg-white text-white dark:text-neutral-900 text-[9px] font-bold flex items-center justify-center tabular-nums shrink-0">
                          {conv.unreadCount! > 9 ? '9+' : conv.unreadCount}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
                <button
                  onClick={() => handleDeleteConversation(conv.id)}
                  disabled={deletingConvId === conv.id || conv.type === 'section'}
                  title={conv.type === 'section' ? 'Ask Class can’t be deleted' : 'Delete conversation'}
                  aria-label="Delete conversation"
                  className={cn(
                    'px-2 self-center mr-2 p-1.5 rounded-md text-neutral-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer shrink-0 disabled:opacity-50 focus-visible:opacity-100',
                    conv.type === 'section' ? 'hidden' : 'opacity-0 group-hover/conv:opacity-100'
                  )}
                >
                  {deletingConvId === conv.id ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );

  const threadContent = (
    <div className="h-full flex flex-col bg-[#fafafa] dark:bg-[#09090b] relative">
      <div className="flex items-center justify-between px-3 sm:px-4 py-2.5 border-b border-neutral-200/70 dark:border-neutral-800/70 shrink-0 bg-[#fafafa]/90 dark:bg-[#09090b]/90 backdrop-blur-sm z-10">
        <div className="flex items-center gap-2.5 min-w-0">
          <button
            onClick={() => setActiveConvId(null)}
            className="md:hidden p-1.5 -ml-1 rounded-md text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100 hover:bg-neutral-200/60 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="w-8 h-8 rounded-full bg-neutral-200 dark:bg-neutral-800 text-neutral-800 dark:text-neutral-100 flex items-center justify-center text-[12px] font-semibold shrink-0">
            {activeConv?.type === 'section' ? (
              <Users className="w-4 h-4" />
            ) : (
              otherName.charAt(0).toUpperCase()
            )}
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-neutral-900 dark:text-neutral-50 truncate leading-tight">
              {otherName}
            </p>
            {otherSection && (
              <p className="text-[11px] text-neutral-500 truncate leading-tight mt-0.5">{otherSection}</p>
            )}
            {activeConv?.type === 'section' && (
              <p className="text-[11px] text-neutral-500 truncate leading-tight mt-0.5">
                Everyone in your section · moderated
              </p>
            )}
            {activeConv?.muted && (
              <p className="text-[11px] text-neutral-400 truncate leading-tight mt-0.5 flex items-center gap-1">
                <BellOff className="w-3 h-3" /> Muted
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          <button
            onClick={() => {
              if (activeConv?.pinnedHomeworkId) {
                handlePinHomework(null);
              } else {
                openPinPicker();
              }
            }}
            disabled={!activeConvId || pinning}
            title={activeConv?.pinnedHomeworkId ? 'Unpin homework' : 'Pin homework PDF'}
            aria-label={activeConv?.pinnedHomeworkId ? 'Unpin homework' : 'Pin homework PDF'}
            className={cn(
              'p-1.5 rounded-md transition-colors cursor-pointer disabled:opacity-50',
              activeConv?.pinnedHomeworkId
                ? 'text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40'
                : 'text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800'
            )}
          >
            {pinning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Pin className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={handleToggleMute}
            disabled={!activeConvId || muting}
            title={activeConv?.muted ? 'Unmute notifications' : 'Mute notifications'}
            aria-label={activeConv?.muted ? 'Unmute' : 'Mute'}
            className="p-1.5 rounded-md text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer disabled:opacity-50"
          >
            {muting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : activeConv?.muted ? (
              <BellOff className="w-3.5 h-3.5" />
            ) : (
              <Bell className="w-3.5 h-3.5" />
            )}
          </button>
          <button
            onClick={handleReportConversation}
            disabled={!activeConvId || reportingConv}
            title="Report this chat"
            aria-label="Report this chat"
            className="p-1.5 rounded-md text-neutral-400 hover:text-amber-700 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40 transition-colors cursor-pointer disabled:opacity-50"
          >
            {reportingConv ? <Loader2 className="w-4 h-4 animate-spin" /> : <Flag className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => activeConvId && handleDeleteConversation(activeConvId)}
            disabled={!activeConvId || deletingConvId === activeConvId || activeConv?.type === 'section'}
            title={activeConv?.type === 'section' ? 'Ask Class can’t be deleted' : 'Delete conversation'}
            aria-label="Delete conversation"
            className={cn(
              'p-1.5 rounded-md text-neutral-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer shrink-0 disabled:opacity-50',
              activeConv?.type === 'section' && 'hidden'
            )}
          >
            {deletingConvId === activeConvId ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Trash2 className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {activeConv?.pinnedHomework && (
        <div className="mx-3 mt-2 mb-0 flex items-start gap-2.5 rounded-xl border border-amber-200/70 dark:border-amber-900/40 bg-amber-50/90 dark:bg-amber-950/30 px-3 py-2.5 shrink-0">
          <Pin className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400 mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[12px] font-semibold text-amber-950 dark:text-amber-100 truncate">
              {activeConv.pinnedHomework.subject}
              {activeConv.pinnedHomework.date ? (
                <span className="font-normal text-amber-800/70 dark:text-amber-300/70">
                  {' '}
                  · {activeConv.pinnedHomework.date}
                </span>
              ) : null}
            </p>
            {activeConv.pinnedHomework.content && (
              <p className="text-[11px] text-amber-900/70 dark:text-amber-200/60 line-clamp-2 mt-0.5">
                {activeConv.pinnedHomework.content}
              </p>
            )}
            {activeConv.pinnedHomework.attachmentUrl && (
              <a
                href={activeConv.pinnedHomework.attachmentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 mt-1.5 text-[11px] font-medium text-amber-800 dark:text-amber-300 hover:underline"
              >
                <FileText className="w-3 h-3" />
                Open PDF
                <Download className="w-3 h-3" />
              </a>
            )}
          </div>
          <button
            onClick={() => handlePinHomework(null)}
            disabled={pinning}
            className="p-1 rounded-md text-amber-700/70 dark:text-amber-400/70 hover:text-amber-900 dark:hover:text-amber-200 cursor-pointer shrink-0"
            title="Unpin"
            aria-label="Unpin homework"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div
        ref={messagesScrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
          stickToBottomRef.current = distance < 80;
          setShowScrollBottom(distance > 120);
        }}
        className="flex-1 overflow-y-auto px-3 sm:px-5 py-4 relative"
      >
        {messagesLoading && messages.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-4 h-4 animate-spin text-neutral-400" />
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <p className="text-[13px] font-medium text-neutral-600 dark:text-neutral-300">Say hello</p>
            <p className="text-[12px] text-neutral-400 mt-1.5 max-w-[16rem] leading-relaxed">
              Share homework notes, a PDF, or a photo when it helps.
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {messages.map((m, idx) => {
              const isMine = Boolean(m.isMine);
              const isPending = String(m.id).startsWith('temp_');
              const isImage =
                m.mimeType?.startsWith('image/') ||
                Boolean(m.attachmentUrl?.match(/\.(jpg|jpeg|png|webp|gif)$/i));
              const prev = messages[idx - 1];
              const next = messages[idx + 1];
              const showDay = !prev || !sameCalendarDay(prev.createdAt, m.createdAt);
              const clusteredWithPrev =
                prev &&
                Boolean(prev.isMine) === isMine &&
                sameCalendarDay(prev.createdAt, m.createdAt) &&
                new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60 * 1000;
              const clusteredWithNext =
                next &&
                Boolean(next.isMine) === isMine &&
                sameCalendarDay(next.createdAt, m.createdAt) &&
                new Date(next.createdAt).getTime() - new Date(m.createdAt).getTime() < 5 * 60 * 1000;
              const timeStr = new Date(m.createdAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              });

              return (
                <React.Fragment key={m.id}>
                  {showDay && (
                    <div className="flex justify-center py-3">
                      <span className="text-[10px] font-medium tracking-wide text-neutral-400 bg-neutral-200/50 dark:bg-neutral-800/60 px-2.5 py-0.5 rounded-full">
                        {formatChatDayLabel(m.createdAt)}
                      </span>
                    </div>
                  )}
                  <div
                    className={cn(
                      'flex w-full',
                      isMine ? 'justify-end' : 'justify-start',
                      clusteredWithPrev ? 'mt-0.5' : 'mt-2.5'
                    )}
                  >
                    <div
                      className={cn(
                        'max-w-[78%] sm:max-w-[62%] px-3 py-2 text-[13px] leading-relaxed relative group',
                        isMine
                          ? 'bg-neutral-900 text-neutral-50 dark:bg-[#e8e6e1] dark:text-neutral-900'
                          : 'bg-white text-neutral-900 dark:bg-[#1a1a1e] dark:text-neutral-100 border border-neutral-200/80 dark:border-neutral-800',
                        !clusteredWithPrev && !clusteredWithNext && 'rounded-2xl',
                        !clusteredWithPrev && clusteredWithNext && isMine && 'rounded-2xl rounded-br-md',
                        !clusteredWithPrev && clusteredWithNext && !isMine && 'rounded-2xl rounded-bl-md',
                        clusteredWithPrev && !clusteredWithNext && isMine && 'rounded-2xl rounded-tr-md',
                        clusteredWithPrev && !clusteredWithNext && !isMine && 'rounded-2xl rounded-tl-md',
                        clusteredWithPrev && clusteredWithNext && isMine && 'rounded-md rounded-tr-md rounded-br-md',
                        clusteredWithPrev && clusteredWithNext && !isMine && 'rounded-md rounded-tl-md rounded-bl-md',
                        isPending && 'opacity-70'
                      )}
                    >
                      {!isPending && (
                        <>
                          <button
                            onClick={() => setReplyingTo(m)}
                            title="Reply to message"
                            aria-label="Reply to message"
                            className={cn(
                              'absolute top-1/2 -translate-y-1/2 p-1 rounded-full text-neutral-400 hover:text-blue-600 dark:hover:text-blue-400 transition-all cursor-pointer opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                              isMine ? '-left-9' : '-right-9'
                            )}
                          >
                            <Reply className="w-3.5 h-3.5" />
                          </button>
                          {isMine && (
                            <button
                              onClick={() => handleDeleteMessage(m.id)}
                              disabled={deletingMessageId === m.id}
                              title="Delete message"
                              aria-label="Delete message"
                              className="absolute -left-[4.25rem] top-1/2 -translate-y-1/2 p-1 rounded-full text-neutral-400 hover:text-rose-600 dark:hover:text-rose-400 transition-all cursor-pointer disabled:opacity-50 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                            >
                              {deletingMessageId === m.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="w-3.5 h-3.5" />
                              )}
                            </button>
                          )}
                        </>
                      )}

                      {m.replyTo && (
                        <div className={cn(
                          "text-[11px] mb-2 pb-1.5 border-l-2 pl-2 italic opacity-70",
                          isMine
                            ? "border-white/30 dark:border-black/30"
                            : "border-neutral-300 dark:border-neutral-700"
                        )}>
                          <div className="font-medium">{m.replyTo.senderName || 'User'}</div>
                          <div className="line-clamp-2">{m.replyTo.content || '[attachment]'}</div>
                        </div>
                      )}

                      {m.attachmentUrl && (
                        <div className="mb-1.5 rounded-xl overflow-hidden">
                          {isImage ? (
                            <button
                              type="button"
                              onClick={() =>
                                setPreviewMedia({
                                  url: m.attachmentUrl!,
                                  name: m.originalFilename || 'Image',
                                })
                              }
                              className="block w-full cursor-pointer"
                            >
                              <img
                                src={m.attachmentUrl}
                                alt={m.originalFilename || 'Attachment'}
                                className="w-full h-auto object-cover max-h-52 rounded-lg"
                              />
                            </button>
                          ) : (
                            <a
                              href={m.attachmentUrl}
                              download={m.originalFilename || 'file'}
                              className={cn(
                                'flex items-center gap-2 px-2 py-2 rounded-lg text-[12px] font-medium',
                                isMine
                                  ? 'bg-white/10 dark:bg-black/10'
                                  : 'bg-neutral-100 dark:bg-neutral-900'
                              )}
                            >
                              <FileText className="w-4 h-4 shrink-0 opacity-70" />
                              <span className="truncate flex-1">{m.originalFilename || 'Document'}</span>
                              <Download className="w-3.5 h-3.5 shrink-0 opacity-70" />
                            </a>
                          )}
                        </div>
                      )}

                      <div className="flex items-end gap-2">
                        {m.content && (
                          <MarkdownRenderer
                            content={m.content}
                            className="break-words leading-relaxed flex-1 text-[13px]"
                          />
                        )}
                        {!clusteredWithNext && (
                          <span
                            className={cn(
                              'text-[10px] shrink-0 tabular-nums self-end mb-px opacity-50 flex items-center gap-1',
                              isMine ? 'text-neutral-300 dark:text-neutral-600' : 'text-neutral-500'
                            )}
                          >
                            {isPending ? 'Sending' : timeStr}
                            {isMine && !isPending && m.readBy && m.readBy.length > 0 && (
                              <CheckCheck className="w-3 h-3" title={`Read by ${m.readBy.length}`} />
                            )}
                            {isMine && !isPending && (!m.readBy || m.readBy.length === 0) && (
                              <Check className="w-3 h-3" title="Sent" />
                            )}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </React.Fragment>
              );
            })}
          </div>
        )}
        <div ref={messagesEndRef} />

        {showScrollBottom && (
          <button
            onClick={() => {
              stickToBottomRef.current = true;
              messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
            }}
            aria-label="Scroll to bottom"
            className="sticky bottom-2 left-full -translate-x-10 z-30 p-2 rounded-full bg-white dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 border border-neutral-200 dark:border-neutral-700 shadow-sm hover:text-neutral-900 dark:hover:text-white cursor-pointer"
          >
            <ArrowDown className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="px-3 sm:px-4 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pb-3 shrink-0 bg-[#fafafa] dark:bg-[#09090b] z-20">
        {fileError && (
          <div className="mb-2 px-3 py-2 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200/70 dark:border-rose-900/50 text-[12px] text-rose-800 dark:text-rose-200 leading-relaxed">
            {fileError}
          </div>
        )}

        {attachedRequest && (
          <div className="mb-2 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#141417] p-2.5 text-[12px]">
            <div className="flex items-start gap-2.5">
              <div className="w-7 h-7 rounded-md bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 flex items-center justify-center shrink-0">
                <Handshake className="w-3.5 h-3.5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-[0.12em] text-neutral-400 font-medium">
                  Request{attachedRequest.category ? ` · ${attachedRequest.category}` : ''}
                </p>
                <p className="font-semibold text-neutral-900 dark:text-neutral-100 mt-0.5 leading-snug">
                  {attachedRequest.title}
                </p>
                {attachedRequest.content.trim() && (
                  <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-1 whitespace-pre-wrap leading-relaxed line-clamp-3">
                    {attachedRequest.content}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => setAttachedRequest(null)}
                className="p-1 rounded-md text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 cursor-pointer shrink-0"
                aria-label="Dismiss request"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {selectedFile && (
          <div className="mb-2 px-2.5 py-2 rounded-lg bg-white dark:bg-[#141417] border border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-2 text-[12px]">
            <div className="flex items-center gap-2 min-w-0">
              <Paperclip className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
              <span className="font-medium truncate">{selectedFile.name}</span>
            </div>
            <button
              onClick={() => setSelectedFile(null)}
              className="p-1 rounded-md text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {replyingTo && (
          <div className="mb-2 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 flex items-start gap-2">
            <Reply className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-medium text-blue-900 dark:text-blue-300">
                Replying to {replyingTo.senderName || 'User'}
              </div>
              <div className="text-[11px] text-blue-700 dark:text-blue-400 truncate">
                {replyingTo.content || '[attachment]'}
              </div>
            </div>
            <button
              onClick={() => setReplyingTo(null)}
              className="p-0.5 rounded-full text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 cursor-pointer shrink-0"
              aria-label="Cancel reply"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div className="flex items-end gap-2 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#141417] px-1.5 py-1.5 shadow-2xs">
          <input
            type="file"
            ref={fileInputRef}
            className="hidden"
            accept=".pdf,.jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp,application/pdf"
            onChange={(e) => {
              const picked = e.target.files?.[0];
              e.target.value = '';
              if (picked) handlePickFile(picked);
            }}
          />
          <button
            type="button"
            onMouseEnter={() => setHoveredAction('attach')}
            onMouseLeave={() => setHoveredAction(null)}
            onClick={() => fileInputRef.current?.click()}
            className="p-2 rounded-xl text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer shrink-0"
            title="Attach PDF or photo"
            aria-label="Attach PDF or photo"
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
            placeholder="Message…"
            className="flex-1 text-[13px] py-2 px-1 bg-transparent text-neutral-900 dark:text-neutral-100 placeholder:text-neutral-400 focus:outline-none resize-none max-h-32 leading-relaxed overflow-y-auto [&::-webkit-scrollbar]:hidden [scrollbar-width:none]"
          />

          <button
            onClick={handleSend}
            disabled={(!inputText.trim() && !selectedFile) || sending}
            className="p-2 rounded-xl bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900 hover:opacity-90 transition-opacity disabled:opacity-25 cursor-pointer shrink-0 mb-0.5"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-4 h-4" />}
          </button>
        </div>
        <p className="mt-1.5 px-1 text-[10px] text-neutral-400">
          PDFs and photos only · Enter to send
        </p>
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
          <div className="flex-1 flex flex-col items-center justify-center gap-2 bg-[#fafafa] dark:bg-[#09090b] px-6 text-center">
            <MessageSquareIcon size={28} className="text-neutral-300 dark:text-neutral-700" />
            <p className="text-[13px] font-medium text-neutral-600 dark:text-neutral-400">
              Pick a conversation
            </p>
            <p className="text-[12px] text-neutral-400 max-w-[16rem] leading-relaxed">
              Or search a student ID in the sidebar to start one.
            </p>
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
              <SearchIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
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

      {showPinPicker && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50 backdrop-blur-sm"
          onClick={() => !pinning && setShowPinPicker(false)}
        >
          <div
            className="w-full sm:max-w-md max-h-[75vh] rounded-t-2xl sm:rounded-2xl bg-white dark:bg-[#141417] border border-neutral-200 dark:border-neutral-800 shadow-xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200/80 dark:border-neutral-800">
              <div>
                <p className="text-[14px] font-semibold text-neutral-900 dark:text-neutral-50">Pin homework</p>
                <p className="text-[11px] text-neutral-500 mt-0.5">Only items with a PDF or file</p>
              </div>
              <button
                onClick={() => setShowPinPicker(false)}
                disabled={pinning}
                className="p-1.5 rounded-md text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 cursor-pointer"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {pinLoading ? (
                <div className="flex justify-center py-10">
                  <Loader2 className="w-4 h-4 animate-spin text-neutral-400" />
                </div>
              ) : pinCandidates.length === 0 ? (
                <p className="text-[13px] text-neutral-500 text-center py-10 px-6 leading-relaxed">
                  No homework with attachments yet. Attachments from your school diary will show up here.
                </p>
              ) : (
                pinCandidates.map((hw) => (
                  <button
                    key={hw.id}
                    disabled={pinning}
                    onClick={() => hw.id && handlePinHomework(hw.id)}
                    className="w-full text-left px-3 py-2.5 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800/80 transition-colors cursor-pointer disabled:opacity-50 flex items-start gap-3"
                  >
                    <div className="w-9 h-9 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 flex items-center justify-center shrink-0">
                      <FileText className="w-4 h-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-neutral-900 dark:text-neutral-100 truncate">
                        {hw.subject || 'Homework'}
                      </p>
                      <p className="text-[11px] text-neutral-500 mt-0.5">
                        {hw.date}
                        {hw.attachment ? ' · has file' : ''}
                      </p>
                      {hw.homework && (
                        <p className="text-[11px] text-neutral-400 line-clamp-2 mt-1">{hw.homework}</p>
                      )}
                    </div>
                  </button>
                ))
              )}
            </div>
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
          helpDialogShownRef.current = false;
          helpProcessedKeyRef.current = null;
          setShowNoticeDialog(false);
          setPendingParticipant(null);
          setAttachedRequest(null);
          pendingPrefillRef.current = null;
          clearPendingMessageOpen();
        }}
      />
    </div>
  );
};

