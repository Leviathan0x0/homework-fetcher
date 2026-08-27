import React, { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../lib/api';
import { messagingService, homeworkService } from '../services/api';
import { motion, useReducedMotion } from 'motion/react';
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
import { AuthenticatedImage } from './AuthenticatedImage';
import { ProfileAvatar } from './ProfileAvatar';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { Reicon, Reillustration } from './ui/reicon';
import { Ring } from "@/components/loading-ui/ring";
import {
  clearPendingMessageOpen,
  peekPendingMessageOpen,
  encodeRequestInMessage,
  messagePreviewText,
  type PendingRequestContext,
} from '../utils/pendingMessageOpen';


interface MessagesViewProps {
  userSection?: string;
  currentStudentId?: string;
  role?: 'student' | 'teacher' | 'admin';
}

/** Turns stored section codes into a clear class-group title, e.g. "9-C" → "Class 9-C". */
function classGroupLabel(section?: string | null) {
  if (!section || isUnknownSection(section)) return 'Class group';
  const cleaned = section.replace(/^Section\s+/i, '').trim();
  if (!cleaned) return 'Class group';
  if (/^class\b/i.test(cleaned)) return cleaned;
  return `Class ${cleaned}`;
}

/** Fake placeholder used before EduSecure section is known - never show it. */
function isUnknownSection(section?: string | null) {
  if (!section) return true;
  const cleaned = String(section).trim();
  if (!cleaned) return true;
  return cleaned.toLowerCase() === 'section 10-a';
}

/** Identifier the server uses to recognise a resent draft. */
function newDraftId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const MessagesView: React.FC<MessagesViewProps> = ({ userSection, currentStudentId: accountStudentId }) => {
  const prefersReducedMotion = useReducedMotion();
  // Seeded from the last load so the inbox paints immediately instead of
  // showing an empty list until the first request comes back.
  const [conversations, setConversations] = useState<Conversation[]>(
    () => messagingService.getCachedConversations() as Conversation[]
  );
  const [isLoading, setIsLoading] = useState(() => messagingService.getCachedConversations().length === 0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messagesConvId, setMessagesConvId] = useState<string | null>(null);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [inputText, setInputText] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [attachedRequest, setAttachedRequest] = useState<PendingRequestContext | null>(null);
  const pendingPrefillRef = useRef<string | null>(null);
  const draftIdRef = useRef<{ id: string; signature: string } | null>(null);
  const [deletingMessageId, setDeletingMessageId] = useState<string | null>(null);
  const [deletingConvId, setDeletingConvId] = useState<string | null>(null);
  const [reportingConv, setReportingConv] = useState(false);
  const currentStudentId = accountStudentId || sessionStorage.getItem('activeStudentId') || 'Student';
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [replyingTo, setReplyingTo] = useState<Message | null>(null);
  const [showPinPicker, setShowPinPicker] = useState(false);
  const [pinCandidates, setPinCandidates] = useState<HomeworkEntry[]>([]);
  const [pinLoading, setPinLoading] = useState(false);
  const [pinning, setPinning] = useState(false);
  const [muting, setMuting] = useState(false);
  const [askClassBusy, setAskClassBusy] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [sectionMembers, setSectionMembers] = useState<
    Array<{ id: string; studentId: string; displayName?: string | null; profilePictureUrl?: string | null; section?: string | null }>
  >([]);
  const [membersLoading, setMembersLoading] = useState(false);

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
    {
      id: string | null;
      studentId: string;
      displayName?: string | null;
      profilePictureUrl?: string | null;
      name?: string;
      section?: string | null;
      provisional?: boolean;
    }[]
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
  const activeConvIdRef = useRef(activeConvId);
  const messagesRequestIdRef = useRef(0);
  const newestServerAtRef = useRef<string | null>(null);
  const loadedMessagesConvIdRef = useRef<string | null>(null);
  activeConvIdRef.current = activeConvId;

  const userLabel = (u?: { displayName?: string | null; studentId?: string } | null) =>
    u?.displayName || 'Student';

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
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchConversations();
    // Inbox list can refresh more slowly - active thread has its own poller.
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') fetchConversations();
    }, 12000);
    return () => clearInterval(interval);
  }, [fetchConversations]);

  const helpDialogShownRef = useRef(false);
  const helpProcessedKeyRef = useRef<string | null>(null);
  const noticeConfirmingRef = useRef(false);
  const pendingHelpRef = useRef<{
    prefill?: string;
    request?: PendingRequestContext | null;
  }>({});
  const conversationsRef = useRef(conversations);
  conversationsRef.current = conversations;

  const MONITOR_ACK_KEY = 'messaging_monitor_ack_v1';

  const hasMonitorAck = () => {
    try {
      return sessionStorage.getItem(MONITOR_ACK_KEY) === '1';
    } catch {
      return false;
    }
  };

  const setMonitorAck = () => {
    try {
      sessionStorage.setItem(MONITOR_ACK_KEY, '1');
    } catch {
      // ignore
    }
  };

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
    // Never treat class-group / section threads as a DM with a classmate.
    const dms = list.filter((c) => c.type !== 'section');
    const byConvId = dms.find((c) => c.id === targetId);
    if (byConvId) return byConvId.id;
    const byUserId = dms.find(
      (c) => c.otherUser?.id === targetId || c.otherUser?.studentId === targetId
    );
    if (byUserId) return byUserId.id;
    return null;
  }, []);

  const openResolvedChat = useCallback(
    (convId: string, prefill?: string, request?: PendingRequestContext | null) => {
      helpDialogShownRef.current = false;
      noticeConfirmingRef.current = false;
      setShowNoticeDialog(false);
      setPendingParticipant(null);
      const help = pendingHelpRef.current;
      applyHelpContext(prefill ?? help.prefill, request !== undefined ? request : help.request);
      pendingHelpRef.current = {};
      setActiveConvId(convId);
      clearPendingMessageOpen();
    },
    [applyHelpContext]
  );

  const showMonitorNotice = useCallback((participant: { id: string; name: string }) => {
    if (noticeConfirmingRef.current) return;
    if (helpDialogShownRef.current) return;
    helpDialogShownRef.current = true;
    setPendingParticipant(participant);
    setShowNoticeDialog(true);
  }, []);

  const openHelpTarget = useCallback(
    async (targetId: string, prefill?: string, request?: PendingRequestContext | null) => {
      if (noticeConfirmingRef.current) return;
      pendingHelpRef.current = { prefill, request };
      applyHelpContext(prefill, request);

      const cachedId = resolveConvId(conversationsRef.current, targetId);
      if (cachedId) {
        openResolvedChat(cachedId, prefill, request);
        return;
      }

      // Refresh in the background - never block the acknowledgement dialog on network.
      void fetchConversations().then(() => {
        if (noticeConfirmingRef.current) return;
        const id = resolveConvId(conversationsRef.current, targetId);
        if (id) openResolvedChat(id, prefill, request);
      });

      // Resolve student-ID deep links to a real user id before the notice dialog
      // mints a token keyed to that peer.
      let resolvedId = targetId;
      let resolvedName =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          targetId
        )
          ? 'Student'
          : targetId;
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          targetId
        )
      ) {
        try {
          const user = await messagingService.resolveUser(targetId);
          resolvedId = user.id;
          resolvedName = user.displayName || user.studentId || 'Student';
        } catch {
          // Server notice-token / startConversation can still resolve student IDs.
        }
      }

      // Already acknowledged this browser session - create/open without waiting again.
      if (hasMonitorAck()) {
        noticeConfirmingRef.current = true;
        try {
          const data = await messagingService.startConversation(currentStudentId, resolvedId, null);
          if (data.type === 'section') {
            throw new Error('Could not open a direct chat with this student. Try again.');
          }
          openResolvedChat(data.conversationId, prefill, request);
          setConversations((prev) => {
            if (prev.some((c) => c.id === data.conversationId)) return prev;
            return [
              {
                id: data.conversationId,
                type: 'dm',
                otherUser: data.otherUser,
                unreadCount: 0,
                lastMessagePreview: data.existing ? undefined : 'Started a new conversation',
                lastMessageAt: new Date().toISOString(),
              },
              ...prev,
            ];
          });
        } catch (err: any) {
          noticeConfirmingRef.current = false;
          if (err?.needsNotice) {
            showMonitorNotice({
              id: resolvedId,
              name: resolvedName,
            });
            return;
          }
          alert(err.message || 'Failed to start conversation.');
          clearPendingMessageOpen();
        }
        return;
      }

      showMonitorNotice({
        id: resolvedId,
        name: resolvedName,
      });
    },
    [
      applyHelpContext,
      resolveConvId,
      fetchConversations,
      openResolvedChat,
      showMonitorNotice,
      currentStudentId,
    ]
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
        openResolvedChat(conversationId);
        return;
      }

      // Bare string may be either a conversation id or a user/student id.
      if (typeof raw === 'string' && raw) {
        const existing = conversationsRef.current.find((c) => c.id === raw);
        if (existing) {
          openResolvedChat(raw);
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
      // Same Help handoff already handled - don't re-open the notice.
      if (helpProcessedKeyRef.current === key && (helpDialogShownRef.current || activeConvId)) {
        return;
      }
      helpProcessedKeyRef.current = key;
      void openHelpTarget(targetId, prefill || undefined, request);
    };

    window.addEventListener('open_conversation', handleOpenConv);
    return () => window.removeEventListener('open_conversation', handleOpenConv);
  }, [applyHelpContext, openHelpTarget, openResolvedChat, activeConvId]);

  // One-shot sessionStorage handoff from Requests → Messages or notification taps.
  useEffect(() => {
    const pending = peekPendingMessageOpen();
    if (!pending) return;

    if (pending.conversationId) {
      openResolvedChat(pending.conversationId);
      return;
    }

    if (!pending.targetId) return;
    const key = `${pending.targetId}:${pending.request?.id || pending.prefill || ''}`;
    if (helpProcessedKeyRef.current === key) return;
    helpProcessedKeyRef.current = key;
    void openHelpTarget(pending.targetId, pending.prefill, pending.request ?? null);
  }, [openHelpTarget, openResolvedChat]);

  // If Help opened before conversations loaded, jump into the chat once it appears.
  useEffect(() => {
    const pending = peekPendingMessageOpen();
    if (!pending?.targetId) return;
    const resolvedId = resolveConvId(conversations, pending.targetId);
    if (!resolvedId) return;
    openResolvedChat(resolvedId, pending.prefill, pending.request ?? null);
  }, [conversations, resolveConvId, openResolvedChat]);

  useEffect(() => {
    if (!activeConvId) return;
    if (pendingPrefillRef.current) {
      const text = pendingPrefillRef.current;
      pendingPrefillRef.current = null;
      setInputText(text);
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.style.height = '0px';
          el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
          el.focus();
        }
      });
    }
    if (peekPendingMessageOpen()) clearPendingMessageOpen();
  }, [activeConvId]);

  const fetchMessages = useCallback(async (
    convId: string,
    silent: boolean = false,
    signal?: AbortSignal,
    after?: string | null
  ) => {
    const requestId = ++messagesRequestIdRef.current;
    if (!silent) setMessagesLoading(true);
    try {
      const msgs = (await messagingService.getMessages(convId, signal, after)) as Message[];
      if (
        signal?.aborted ||
        activeConvIdRef.current !== convId ||
        requestId !== messagesRequestIdRef.current
      ) return;
      const newestAt = msgs.reduce(
        (max, m) => Math.max(max, new Date(m.createdAt).getTime()),
        0
      );
      if (newestAt > 0) newestServerAtRef.current = new Date(newestAt).toISOString();
      setMessages((prev) => {
        const map = new Map<string, Message>();
        if (after) {
          // Incremental poll: keep what we already have and overlay new arrivals.
          prev.forEach((m) => map.set(m.id, m));
          msgs.forEach((m: Message) => map.set(m.id, m));
        } else {
          // Initial load: replace the list but keep optimistic temps and any
          // local-only sends the poll hasn't returned yet.
          msgs.forEach((m: Message) => map.set(m.id, m));
          const newestServerAt = msgs.length
            ? new Date(msgs[msgs.length - 1].createdAt).getTime()
            : 0;
          prev.forEach((m) => {
            if (m.conversationId !== convId || map.has(m.id)) return;
            if (String(m.id).startsWith('temp_')) {
              map.set(m.id, m);
              return;
            }
            if (new Date(m.createdAt).getTime() > newestServerAt) map.set(m.id, m);
          });
        }
        const next = Array.from(map.values()).sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
        const nextFp = next.map((m) => `${m.id}:${(m.readBy || []).length}`).join(',');
        if (silent && nextFp === messagesFpRef.current) return prev;
        messagesFpRef.current = nextFp;
        return next;
      });
      loadedMessagesConvIdRef.current = convId;
      setMessagesConvId(convId);
    } catch (err) {
      if (signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) return;
      if (
        !silent &&
        activeConvIdRef.current === convId &&
        requestId === messagesRequestIdRef.current
      ) {
        // The request finished for the selected thread, so stop the loading
        // skeleton without exposing data owned by another conversation.
        loadedMessagesConvIdRef.current = convId;
        setMessages([]);
        setMessagesConvId(convId);
      }
    } finally {
      if (
        !silent &&
        !signal?.aborted &&
        activeConvIdRef.current === convId &&
        requestId === messagesRequestIdRef.current
      ) {
        setMessagesLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (!activeConvId) {
      messagesRequestIdRef.current += 1;
      loadedMessagesConvIdRef.current = null;
      setMessages([]);
      setMessagesConvId(null);
      setMessagesLoading(false);
      return;
    }

    const controller = new AbortController();
    stickToBottomRef.current = true;
    messagesFpRef.current = '';
    newestServerAtRef.current = null;
    loadedMessagesConvIdRef.current = null;
    setMessages([]);
    setMessagesConvId(null);
    setMessagesLoading(true);
    fetchMessages(activeConvId, false, controller.signal);
    messagingService.markAsRead(activeConvId);
    setConversations((prev) =>
      prev.map((c) => (c.id === activeConvId ? { ...c, unreadCount: 0 } : c))
    );
    window.dispatchEvent(new CustomEvent('messages_unread_changed'));

    const messageInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        if (loadedMessagesConvIdRef.current === activeConvId) {
          fetchMessages(activeConvId, true, controller.signal, newestServerAtRef.current);
        }
        messagingService.markAsRead(activeConvId);
      }
    }, 5000);

    return () => {
      controller.abort();
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

    const convId = activeConvId;
    const textCopy = inputText;
    const fileCopy = selectedFile;
    const replyToCopy = replyingTo;
    const requestCopy = attachedRequest;
    const bodyText = textCopy.trim();
    const contentForSend = requestCopy
      ? encodeRequestInMessage(requestCopy, bodyText)
      : bodyText;
    // Identifies this draft for as long as it stays unsent. A retry after a
    // failure reuses the id, so an attempt that reached the server but never
    // answered cannot end up posted twice. Editing the draft starts a new one.
    const draftSignature = [
      contentForSend,
      fileCopy ? `${fileCopy.name}:${fileCopy.size}` : '',
      replyToCopy?.id || '',
    ].join('|');
    if (draftIdRef.current?.signature !== draftSignature) {
      draftIdRef.current = { id: newDraftId(), signature: draftSignature };
    }
    const clientMessageId = draftIdRef.current.id;
    const previewText = messagePreviewText(
      contentForSend,
      fileCopy ? `[Attachment] ${fileCopy.name}` : ''
    );
    const tempId = `temp_${Date.now()}`;
    const optimistic: Message = {
      id: tempId,
      conversationId: convId,
      senderId: 'local',
      content: contentForSend,
      displayContent: bodyText,
      requestRef: requestCopy
        ? {
            id: requestCopy.id,
            title: requestCopy.title,
            content: requestCopy.content,
            category: requestCopy.category,
          }
        : null,
      attachmentUrl: fileCopy && fileCopy.type.startsWith('image/')
        ? URL.createObjectURL(fileCopy)
        : null,
      originalFilename: fileCopy?.name || null,
      mimeType: fileCopy?.type || null,
      replyTo: replyToCopy ? {
        id: replyToCopy.id,
        senderId: replyToCopy.senderId,
        senderName: replyToCopy.senderName,
        content: messagePreviewText(
          replyToCopy.displayContent ?? replyToCopy.content,
          'Help request'
        ).substring(0, 100),
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
    setAttachedRequest(null);
    setFileError(null);
    if (textareaRef.current) textareaRef.current.style.height = '';
    stickToBottomRef.current = true;
    const alreadyShowingConversation = loadedMessagesConvIdRef.current === convId;
    loadedMessagesConvIdRef.current = convId;
    setMessagesConvId(convId);
    setMessages((prev) => alreadyShowingConversation ? [...prev, optimistic] : [optimistic]);
    setConversations((prev) =>
      prev.map((c) =>
        c.id === convId
          ? {
              ...c,
              lastMessagePreview: fileCopy
                ? `[Attachment] ${fileCopy.name}`
                : previewText.substring(0, 80),
              lastMessageAt: optimistic.createdAt,
            }
          : c
      )
    );

    try {
      const sentMessage = await messagingService.sendMessage(
        convId,
        currentStudentId,
        contentForSend,
        fileCopy,
        replyToCopy?.id || null,
        clientMessageId
      );
      draftIdRef.current = null;
      if (optimistic.attachmentUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(optimistic.attachmentUrl);
      }
      if (activeConvIdRef.current === convId) {
        setMessages((prev) => {
          const withoutTemp = prev.filter((m) => m.id !== tempId);
          if (withoutTemp.some((m) => m.id === sentMessage.id)) return withoutTemp;
          return [...withoutTemp, sentMessage];
        });
      }
      setConversations((prev) =>
        prev.map((c) =>
          c.id === convId
            ? {
                ...c,
                lastMessagePreview: fileCopy
                  ? `[Attachment] ${fileCopy.name}`
                  : messagePreviewText(sentMessage.content || '', previewText).substring(0, 80),
                lastMessageAt: sentMessage.createdAt,
              }
            : c
        )
      );
    } catch (err: any) {
      if (optimistic.attachmentUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(optimistic.attachmentUrl);
      }
      if (activeConvIdRef.current === convId) {
        setMessages((prev) => prev.filter((m) => m.id !== tempId));
        setInputText(textCopy);
        setSelectedFile(fileCopy);
        setReplyingTo(replyToCopy);
        setAttachedRequest(requestCopy);
        setFileError(friendlyContentError(err, 'Message could not be sent. Try again.'));
      }
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
      const label = classGroupLabel(target.section);
      if (!confirm(
        `Leave ${label}?\n\nThe group stays for your classmates. You’ll rejoin automatically next time you open Messages.`
      )) return;
      setDeletingConvId(convId);
      try {
        await messagingService.leaveConversation(convId);
        setConversations((prev) => prev.filter((c) => c.id !== convId));
        if (activeConvIdRef.current === convId) {
          setActiveConvId(null);
          setMessages([]);
          loadedMessagesConvIdRef.current = null;
          setMessagesConvId(null);
        }
      } catch (err: any) {
        alert(err.message || 'Could not leave class group.');
      } finally {
        setDeletingConvId(null);
      }
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
        loadedMessagesConvIdRef.current = null;
        setMessagesConvId(null);
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
      alert(typeof data?.message === 'string' ? data.message : 'Thanks - this chat was reported for school review.');
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
      const { items } = await homeworkService.getHomework(currentStudentId);
      const withFiles = (items || []).filter((h: HomeworkEntry) => Boolean(h.attachment));
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
    const existing = conversations.find((c) => c.type === 'section');
    if (existing) {
      setActiveConvId(existing.id);
      setAttachedRequest(null);
      return;
    }
    setAskClassBusy(true);
    try {
      const result = await messagingService.createSectionConversation();
      await fetchConversations();
      setActiveConvId(result.conversationId);
      setAttachedRequest(null);
    } catch (err: any) {
      alert(err.message || 'Failed to open class group.');
    } finally {
      setAskClassBusy(false);
    }
  };

  const openMembersPanel = async () => {
    setShowMembers(true);
    setMembersLoading(true);
    try {
      const data = await messagingService.getSectionMembers();
      setSectionMembers(data.members);
    } catch {
      setSectionMembers([]);
    } finally {
      setMembersLoading(false);
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

  const handleInitiateChat = async (u: {
    id: string | null;
    studentId: string;
    displayName?: string | null;
    provisional?: boolean;
  }) => {
    let target: {
      id: string;
      studentId?: string;
      displayName?: string | null;
      section?: string | null;
    };

    if (u.provisional || !u.id) {
      try {
        setSearching(true);
        target = await messagingService.resolveUser(u.studentId);
      } catch (err: any) {
        alert(err.message || 'Could not look up that student ID.');
        return;
      } finally {
        setSearching(false);
      }
    } else {
      target = {
        id: u.id,
        studentId: u.studentId,
        displayName: u.displayName,
      };
    }

    const name = target.displayName || 'Student';
    const existing = conversations.find((c) => c.otherUser?.id === target.id);
    if (existing) {
      setShowNewModal(false);
      setSearchQuery('');
      setSearchResults([]);
      setActiveConvId(existing.id);
      return;
    }

    setShowNewModal(false);
    setSearchQuery('');
    setSearchResults([]);

    if (hasMonitorAck()) {
      noticeConfirmingRef.current = true;
      try {
        const data = await messagingService.startConversation(currentStudentId, target.id, null);
        openResolvedChat(data.conversationId);
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
        noticeConfirmingRef.current = false;
        if (err?.needsNotice) {
          showMonitorNotice({ id: target.id, name });
          return;
        }
        alert(err.message || 'Failed to start conversation.');
      }
      return;
    }

    showMonitorNotice({ id: target.id, name });
  };

  const handleConfirmNotice = async (noticeToken: string, resolvedParticipantId: string) => {
    if (!pendingParticipant || noticeConfirmingRef.current) return;
    const participantId = resolvedParticipantId || pendingParticipant.id;
    const help = pendingHelpRef.current;
    noticeConfirmingRef.current = true;
    setShowNoticeDialog(false);

    try {
      setMonitorAck();
      const data = await messagingService.startConversation(
        currentStudentId,
        participantId,
        noticeToken
      );
      if (data.type === 'section') {
        throw new Error('Could not open a direct chat with this student. Try again.');
      }
      openResolvedChat(data.conversationId, help.prefill, help.request ?? null);
      setConversations((prev) => {
        if (prev.some((c) => c.id === data.conversationId)) return prev;
        return [
          {
            id: data.conversationId,
            type: 'dm',
            otherUser: data.otherUser,
            unreadCount: 0,
            lastMessagePreview: data.existing ? undefined : 'Started a new conversation',
            lastMessageAt: new Date().toISOString(),
          },
          ...prev,
        ];
      });
    } catch (err: any) {
      noticeConfirmingRef.current = false;
      helpDialogShownRef.current = false;
      setPendingParticipant(null);
      clearPendingMessageOpen();
      alert(err.message || 'Failed to start conversation.');
    }
  };

  const activeConv = conversations.find((c) => c.id === activeConvId);
  const otherName = activeConv
    ? activeConv.type === 'section'
      ? classGroupLabel(activeConv.section)
      : userLabel(activeConv.otherUser)
    : 'Conversation';
  const otherSection =
    activeConv?.type === 'section'
      ? null
      : isUnknownSection(activeConv?.otherUser?.section)
        ? null
        : activeConv?.otherUser?.section;
  const sectionConv = conversations.find((c) => c.type === 'section');
  const classButtonLabel = classGroupLabel(sectionConv?.section || userSection);
  // Never render a thread's messages under another thread's title, even for
  // the render before the selection effect clears local state.
  const visibleMessages = messagesConvId === activeConvId ? messages : [];
  const visibleMessagesLoading = Boolean(activeConvId) && (
    messagesLoading || messagesConvId !== activeConvId
  );

  const inboxContent = (
    <div className="h-full flex flex-col bg-[#f7f7f8] dark:bg-[#0c0c0e]">
      <div className="px-4 pt-4 pb-3 border-b border-neutral-200/70 dark:border-neutral-800/70 shrink-0 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-[15px] font-semibold tracking-tight text-neutral-900 dark:text-neutral-50">
            Messages
          </h2>
          <button
            type="button"
            onClick={handleAskClass}
            disabled={askClassBusy}
            title={sectionConv ? `Open ${classButtonLabel}` : `Join ${classButtonLabel}`}
            aria-label={sectionConv ? `Open ${classButtonLabel}` : `Join ${classButtonLabel}`}
            className="inline-flex items-center gap-1.5 h-8 max-w-[11rem] px-2.5 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-[#141417] text-[11px] font-medium text-neutral-700 dark:text-neutral-200 hover:border-neutral-300 dark:hover:border-neutral-700 transition-colors cursor-pointer disabled:opacity-50 shadow-2xs"
          >
            {askClassBusy ? (
              <Ring className="size-3.5 shrink-0" />
            ) : (
              <Reicon name="users" size={14} className="shrink-0 text-neutral-400" />
            )}
            <span className="truncate">{classButtonLabel}</span>
            {sectionConv?.memberCount ? (
              <span className="tabular-nums text-neutral-400 shrink-0">{sectionConv.memberCount}</span>
            ) : null}
          </button>
        </div>
        <div className="relative">
          <Reicon
            name="search"
            size={14}
            preset="zoom"
            isActive={Boolean(searchQuery)}
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
              <Reicon name="x" size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {searching ? (
          <div className="flex items-center justify-center py-10">
            <Ring className="size-4 text-neutral-400" />
          </div>
        ) : searchQuery.trim() ? (
          searchResults.length > 0 ? (
            searchResults.map((u) => (
              <button
                key={u.id || `prov-${u.studentId}`}
                onClick={() => handleInitiateChat(u)}
                className="w-full text-left px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-neutral-200/50 dark:hover:bg-white/[0.03] transition-colors"
              >
                <ProfileAvatar
                  src={u.profilePictureUrl}
                  name={u.displayName || 'Student'}
                  className="size-10 text-[13px]"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-neutral-900 dark:text-neutral-100 truncate">
                    {u.displayName || 'Student'}
                  </p>
                  <p className="text-[11px] text-neutral-500 truncate mt-0.5">
                    {u.provisional
                      ? 'Not on the app yet - message by student ID'
                      : 'Start a conversation'}
                    {!u.provisional && u.section ? ` · ${u.section}` : ''}
                  </p>
                </div>
              </button>
            ))
          ) : (
            <p className="px-4 py-10 text-center text-[12px] text-neutral-400">
              No match - type their full student ID to message them anyway.
            </p>
          )
        ) : conversations.length === 0 ? (
          isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Ring className="size-4 text-neutral-400" />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
              <div className="mb-3">
                <Reillustration
                  name={
                    currentStudentId === 'admin_mmss'
                      ? 'messages-empty-admin'
                      : userSection === 'Staff'
                        ? 'messages-empty-teacher'
                        : 'messages-empty-student'
                  }
                  size="sm"
                />
              </div>
              <p className="text-[13px] font-semibold text-neutral-900 dark:text-neutral-100">
                {loadError ? 'Couldn’t load chats' : 'No conversations yet'}
              </p>
              <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mt-1 max-w-[16rem] leading-relaxed">
                {loadError || 'Search a student ID or name above to start a conversation.'}
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
                  'group/conv relative flex items-stretch overflow-hidden border-l-2',
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
                  className="flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left cursor-pointer"
                >
                  {conv.type === 'section' ? (
                    <div className={cn(
                      'flex size-10 shrink-0 items-center justify-center rounded-full text-[13px] font-semibold',
                      unread
                        ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
                        : 'bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200'
                    )}>
                      <Reicon name="users" size={20} />
                    </div>
                  ) : (
                    <ProfileAvatar
                      src={conv.otherUser?.profilePictureUrl}
                      name={userLabel(conv.otherUser)}
                      className="size-10 text-[13px]"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="flex min-w-0 flex-1 items-center gap-1.5">
                        <span
                          className={cn(
                            'text-[13px] truncate',
                            unread
                              ? 'font-semibold text-neutral-900 dark:text-neutral-50'
                              : 'font-medium text-neutral-800 dark:text-neutral-200'
                          )}
                        >
                          {conv.type === 'section' ? classGroupLabel(conv.section) : userLabel(conv.otherUser)}
                        </span>
                        {conv.muted && (
                          <Reicon name="bell" size={12} className="text-neutral-400 shrink-0 opacity-50" />
                        )}
                      </div>
                      <div className="shrink-0 transition-[margin] duration-200 ease-out group-hover/conv:mr-7 group-focus-within/conv:mr-7 motion-reduce:transition-none">
                        {conv.lastMessageAt && (
                          <span className="text-[10px] text-neutral-400 tabular-nums">
                            {formatChatListTime(conv.lastMessageAt)}
                          </span>
                        )}
                      </div>
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
                        {conv.type === 'section'
                          ? (messagePreviewText(conv.lastMessagePreview || '', `${conv.memberCount || 0} classmates`))
                          : (messagePreviewText(conv.lastMessagePreview || '', 'No messages yet'))}
                      </p>
                      <div className="flex shrink-0 items-center gap-2 transition-[margin] duration-200 ease-out group-hover/conv:mr-7 group-focus-within/conv:mr-7 motion-reduce:transition-none">
                        {conv.type === 'section' && conv.memberCount ? (
                          <span className="text-[10px] text-neutral-400 tabular-nums">
                            {conv.memberCount}
                          </span>
                        ) : null}
                        {!isUnknownSection(conv.otherUser?.section) && conv.otherUser?.section && (
                          <span className="text-[10px] text-neutral-400">
                            {conv.otherUser.section}
                          </span>
                        )}
                        {unread && (
                          <span className="flex h-[1.1rem] min-w-[1.1rem] items-center justify-center rounded-full bg-neutral-900 px-1 text-[9px] font-bold tabular-nums text-white dark:bg-white dark:text-neutral-900">
                            {conv.unreadCount! > 9 ? '9+' : conv.unreadCount}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
                <button
                  onClick={() => handleDeleteConversation(conv.id)}
                  disabled={deletingConvId === conv.id}
                  title={conv.type === 'section' ? `Leave ${classGroupLabel(conv.section)}` : 'Delete conversation'}
                  aria-label={conv.type === 'section' ? `Leave ${classGroupLabel(conv.section)}` : 'Delete conversation'}
                  className="absolute right-2 top-1/2 z-10 -translate-y-1/2 translate-x-2 rounded-md bg-white/95 p-1.5 text-neutral-400 opacity-0 shadow-2xs transition-all duration-200 hover:bg-rose-50 hover:text-rose-600 focus-visible:translate-x-0 focus-visible:opacity-100 disabled:opacity-50 group-hover/conv:translate-x-0 group-hover/conv:opacity-100 group-focus-within/conv:translate-x-0 group-focus-within/conv:opacity-100 dark:bg-[#141417]/95 dark:hover:bg-rose-950/40 dark:hover:text-rose-400"
                >
                  {deletingConvId === conv.id ? (
                    <Ring className="size-3.5" />
                  ) : conv.type === 'section' ? (
                    <Reicon name="logout" size={14} />
                  ) : (
                    <Reicon name="trash-2" size={14} />
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
            <Reicon name="arrow-left" size={16} preset="lift" className="w-4 h-4" />
          </button>
          {activeConv?.type === 'section' ? (
            <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-neutral-200 text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100">
              <Reicon name="users" size={16} />
            </div>
          ) : (
            <ProfileAvatar
              src={activeConv?.otherUser?.profilePictureUrl}
              name={otherName}
              className="size-8 text-[12px]"
            />
          )}
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-neutral-900 dark:text-neutral-50 truncate leading-tight">
              {otherName}
            </p>
            {otherSection && (
              <p className="text-[11px] text-neutral-500 truncate leading-tight mt-0.5">{otherSection}</p>
            )}
            {activeConv?.type === 'section' && (
              <button
                type="button"
                onClick={openMembersPanel}
                className="text-[11px] text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 truncate leading-tight mt-0.5 cursor-pointer"
              >
                {(activeConv.memberCount || sectionMembers.length || 0) > 0
                  ? `${activeConv.memberCount || sectionMembers.length} classmates · view names`
                  : 'View classmates'}
              </button>
            )}
            {activeConv?.muted && (
              <p className="text-[11px] text-neutral-400 truncate leading-tight mt-0.5 flex items-center gap-1">
                <Reicon name="bell" size={12} className="opacity-50" /> Muted
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-0.5 shrink-0">
          <Tooltip>
            <TooltipTrigger
              render={(
                <button
                  onClick={() => {
                    if (activeConv?.pinnedHomeworkId) {
                      handlePinHomework(null);
                    } else {
                      openPinPicker();
                    }
                  }}
                  disabled={!activeConvId || pinning}
                  title={activeConv?.pinnedHomeworkId ? 'Unpin homework from this chat' : 'Pin homework to this chat'}
                  aria-label={activeConv?.pinnedHomeworkId ? 'Unpin homework from this chat' : 'Pin homework to this chat'}
                  className={cn(
                    'p-1.5 rounded-md transition-colors cursor-pointer disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-400/50',
                    activeConv?.pinnedHomeworkId
                      ? 'text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40'
                      : 'text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                  )}
                >
                  {pinning ? <Ring className="size-3.5" /> : <Reicon name="paperclip" size={14} />}
                </button>
              )}
            />
            <TooltipContent side="bottom">
              {activeConv?.pinnedHomeworkId ? 'Unpin homework from this chat' : 'Pin homework to this chat.'}
            </TooltipContent>
          </Tooltip>
          <button
            onClick={handleToggleMute}
            disabled={!activeConvId || muting}
            title={activeConv?.muted ? 'Unmute notifications' : 'Mute notifications'}
            aria-label={activeConv?.muted ? 'Unmute' : 'Mute'}
            className="p-1.5 rounded-md text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer disabled:opacity-50"
          >
            {muting ? (
              <Ring className="size-3.5" />
            ) : activeConv?.muted ? (
              <Reicon name="bell" size={14} className="opacity-50" />
            ) : (
              <Reicon name="bell" size={14} />
            )}
          </button>
          <button
            onClick={handleReportConversation}
            disabled={!activeConvId || reportingConv}
            title="Report this chat"
            aria-label="Report this chat"
            className="p-1.5 rounded-md text-neutral-400 hover:text-amber-700 dark:hover:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/40 transition-colors cursor-pointer disabled:opacity-50"
          >
            {reportingConv ? <Ring className="size-4" /> : <Reicon name="flag" size={14} />}
          </button>
          <button
            onClick={() => activeConvId && handleDeleteConversation(activeConvId)}
            disabled={!activeConvId || deletingConvId === activeConvId}
            title={activeConv?.type === 'section' ? `Leave ${otherName}` : 'Delete conversation'}
            aria-label={activeConv?.type === 'section' ? `Leave ${otherName}` : 'Delete conversation'}
            className="p-1.5 rounded-md text-neutral-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors cursor-pointer shrink-0 disabled:opacity-50"
          >
            {deletingConvId === activeConvId ? (
              <Ring className="size-4" />
            ) : activeConv?.type === 'section' ? (
              <Reicon name="logout" size={14} />
            ) : (
              <Reicon name="trash-2" size={14} />
            )}
          </button>
        </div>
      </div>

      {activeConv?.pinnedHomework && (
        <div className="mx-3 mt-2 mb-0 flex items-start gap-2.5 rounded-xl border border-amber-200/70 dark:border-amber-900/40 bg-amber-50/90 dark:bg-amber-950/30 px-3 py-2.5 shrink-0" role="status">
          <Reicon name="paperclip" size={14} className="text-amber-700 dark:text-amber-400 mt-0.5 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium text-amber-800/80 dark:text-amber-300/80 mb-0.5">
              Pinned homework in this chat
            </p>
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
                <Reicon name="file-text" size={12} className="w-3 h-3" />
                Open PDF
                <Reicon name="download" size={12} className="w-3 h-3" />
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
            <Reicon name="x" size={14} />
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
        {visibleMessagesLoading && visibleMessages.length === 0 ? (
          <div className="space-y-3 py-8" aria-busy="true" aria-label={`Loading messages for ${otherName}`}>
            <div className="h-9 w-2/5 rounded-2xl bg-neutral-200/70 dark:bg-neutral-800/70 animate-pulse" />
            <div className="ml-auto h-12 w-3/5 rounded-2xl bg-neutral-200/70 dark:bg-neutral-800/70 animate-pulse" />
            <div className="h-16 w-1/2 rounded-2xl bg-neutral-200/70 dark:bg-neutral-800/70 animate-pulse" />
          </div>
        ) : visibleMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
            <div className="mb-4">
              <Reillustration
                name={
                  currentStudentId === 'admin_mmss'
                    ? 'messages-empty-admin'
                    : userSection === 'Staff'
                      ? 'messages-empty-teacher'
                      : 'messages-empty-student'
                }
                size={110}
              />
            </div>
            <p className="text-[13px] font-medium text-neutral-600 dark:text-neutral-300">Say hello</p>
            <p className="text-[12px] text-neutral-400 mt-1.5 max-w-[16rem] leading-relaxed">
              Share homework notes, a PDF, or a photo when it helps.
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {visibleMessages.map((m, idx) => {
              const isMine = Boolean(m.isMine);
              const isPending = String(m.id).startsWith('temp_');
              const isSectionChat = activeConv?.type === 'section';
              const isImage =
                m.mimeType?.startsWith('image/') ||
                Boolean(m.originalFilename?.match(/\.(jpg|jpeg|png|webp|gif)$/i)) ||
                Boolean(m.attachmentUrl?.match(/\.(jpg|jpeg|png|webp|gif)$/i));
              const prev = visibleMessages[idx - 1];
              const next = visibleMessages[idx + 1];
              const showDay = !prev || !sameCalendarDay(prev.createdAt, m.createdAt);
              const sameSenderAs = (other?: Message | null) =>
                Boolean(
                  other &&
                    Boolean(other.isMine) === isMine &&
                    (!isSectionChat || other.senderId === m.senderId)
                );
              const clusteredWithPrev =
                sameSenderAs(prev) &&
                sameCalendarDay(prev!.createdAt, m.createdAt) &&
                new Date(m.createdAt).getTime() - new Date(prev!.createdAt).getTime() < 5 * 60 * 1000;
              const clusteredWithNext =
                sameSenderAs(next) &&
                sameCalendarDay(next!.createdAt, m.createdAt) &&
                new Date(next!.createdAt).getTime() - new Date(m.createdAt).getTime() < 5 * 60 * 1000;
              const timeStr = new Date(m.createdAt).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
              });
              const senderLabel =
                m.senderName?.trim() ||
                'Student';
              const showSenderName = isSectionChat && !isMine && !clusteredWithPrev;

              return (
                <React.Fragment key={m.id}>
                  {showDay && (
                    <div className="flex justify-center py-3">
                      <span className="text-[10px] font-medium text-neutral-400 bg-neutral-200/50 dark:bg-neutral-800/60 px-2.5 py-0.5 rounded-full">
                        {formatChatDayLabel(m.createdAt)}
                      </span>
                    </div>
                  )}
                  <div
                    className={cn(
                      'flex w-full flex-col',
                      isMine ? 'items-end' : 'items-start',
                      clusteredWithPrev ? 'mt-0.5' : 'mt-2.5'
                    )}
                  >
                    {showSenderName && (
                      <div className="mb-1 flex max-w-[78%] items-center gap-1.5 px-1 sm:max-w-[62%]">
                        <ProfileAvatar
                          src={m.senderProfilePictureUrl}
                          name={senderLabel}
                          className="size-5 text-[8px]"
                        />
                        <span className="truncate text-[11px] font-medium text-neutral-500 dark:text-neutral-400">
                          {senderLabel}
                        </span>
                      </div>
                    )}
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
                            <Reicon name="arrow-left" size={14} />
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
                                <Ring className="size-3.5" />
                              ) : (
                                <Reicon name="trash-2" size={14} />
                              )}
                            </button>
                          )}
                        </>
                      )}

                      {m.requestRef && (
                        <div className={cn(
                          "text-[11px] mb-2 pb-1.5 border-l-2 pl-2 not-italic opacity-90",
                          isMine
                            ? "border-white/35 dark:border-black/30"
                            : "border-neutral-300 dark:border-neutral-700"
                        )}>
                          <div className="font-medium flex items-center gap-1">
                            <Reicon name="heart-handshake" size={12} className="shrink-0 opacity-80" />
                            <span>
                              Request
                              {m.requestRef.category ? ` · ${m.requestRef.category}` : ''}
                            </span>
                          </div>
                          <div className="font-semibold mt-0.5 leading-snug">
                            {m.requestRef.title}
                          </div>
                          {m.requestRef.content.trim() && (
                            <div className="line-clamp-2 mt-0.5 opacity-80">
                              {m.requestRef.content}
                            </div>
                          )}
                        </div>
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
                              {m.attachmentUrl.startsWith('blob:') ? (
                                <img
                                  src={m.attachmentUrl}
                                  alt=""
                                  className="w-full h-auto object-cover max-h-52 rounded-lg"
                                />
                              ) : (
                                <AuthenticatedImage
                                  src={m.attachmentUrl}
                                  alt=""
                                  className="w-full h-auto object-cover max-h-52 rounded-lg"
                                />
                              )}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  const res = await apiFetch(m.attachmentUrl!);
                                  if (!res.ok) throw new Error('Download failed');
                                  const blob = await res.blob();
                                  const url = URL.createObjectURL(blob);
                                  const a = document.createElement('a');
                                  a.href = url;
                                  a.download = m.originalFilename || 'file';
                                  a.click();
                                  URL.revokeObjectURL(url);
                                } catch {
                                  window.open(m.attachmentUrl!, '_blank', 'noopener,noreferrer');
                                }
                              }}
                              className={cn(
                                'flex items-center gap-2 px-2 py-2 rounded-lg text-[12px] font-medium w-full text-left cursor-pointer',
                                isMine
                                  ? 'bg-white/10 dark:bg-black/10'
                                  : 'bg-neutral-100 dark:bg-neutral-900'
                              )}
                            >
                              <Reicon name="file-text" size={16} className="w-4 h-4 shrink-0 opacity-70" />
                              <span className="truncate flex-1">{m.originalFilename || 'Document'}</span>
                              <Reicon name="download" size={14} className="w-3.5 h-3.5 shrink-0 opacity-70" />
                            </button>
                          )}
                        </div>
                      )}

                      <div className="flex items-end gap-2">
                        {(m.displayContent ?? m.content) && (
                          <MarkdownRenderer
                            content={m.displayContent ?? m.content}
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
                              <span title={`Read by ${m.readBy.length}`}>
                                <Reicon name="check" size={12} />
                              </span>
                            )}
                            {isMine && !isPending && (!m.readBy || m.readBy.length === 0) && (
                              <span title="Sent">
                                <Reicon name="check" size={12} />
                              </span>
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
            <Reicon name="arrow-down" size={16} />
          </button>
        )}
      </div>

      <div className="px-3 sm:px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:pb-3 shrink-0 bg-[#fafafa] dark:bg-[#09090b] z-20">
        {fileError && (
          <div className="mb-2 px-3 py-2 rounded-lg bg-rose-50 dark:bg-rose-950/40 border border-rose-200/70 dark:border-rose-900/50 text-[12px] text-rose-800 dark:text-rose-200 leading-relaxed">
            {fileError}
          </div>
        )}

        {attachedRequest && (
          <div className="mb-2 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 flex items-start gap-2">
            <Reicon name="arrow-left" size={14} className="text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-medium text-blue-900 dark:text-blue-300">
                Replying to request
                {attachedRequest.category ? ` · ${attachedRequest.category}` : ''}
              </div>
              <div className="text-[12px] font-semibold text-blue-950 dark:text-blue-100 truncate mt-0.5">
                {attachedRequest.title}
              </div>
              {attachedRequest.content.trim() && (
                <div className="text-[11px] text-blue-700 dark:text-blue-400 line-clamp-2 mt-0.5">
                  {attachedRequest.content}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => setAttachedRequest(null)}
              className="p-0.5 rounded-full text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 cursor-pointer shrink-0"
              aria-label="Cancel request reply"
            >
              <Reicon name="x" size={14} />
            </button>
          </div>
        )}

        {selectedFile && (
          <div className="mb-2 px-2.5 py-2 rounded-lg bg-white dark:bg-[#141417] border border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-2 text-[12px]">
            <div className="flex items-center gap-2 min-w-0">
              <Reicon name="paperclip" size={14} className="w-3.5 h-3.5 text-neutral-500 shrink-0" />
              <span className="font-medium truncate">{selectedFile.name}</span>
            </div>
            <button
              onClick={() => setSelectedFile(null)}
              className="p-1 rounded-md text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 cursor-pointer"
            >
              <Reicon name="x" size={14} />
            </button>
          </div>
        )}

        {replyingTo && !attachedRequest && (
          <div className="mb-2 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900 flex items-start gap-2">
            <Reicon name="arrow-left" size={14} className="text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-medium text-blue-900 dark:text-blue-300">
                Replying to {replyingTo.senderName || 'User'}
              </div>
              <div className="text-[11px] text-blue-700 dark:text-blue-400 truncate">
                {messagePreviewText(replyingTo.displayContent ?? replyingTo.content, '[attachment]')}
              </div>
            </div>
            <button
              onClick={() => setReplyingTo(null)}
              className="p-0.5 rounded-full text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 cursor-pointer shrink-0"
              aria-label="Cancel reply"
            >
              <Reicon name="x" size={14} />
            </button>
          </div>
        )}

        <div className="flex items-end gap-2 rounded-2xl border border-neutral-200 bg-white px-1.5 py-1 shadow-2xs dark:border-neutral-800 dark:bg-[#141417]">
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
            onClick={() => fileInputRef.current?.click()}
            className="flex size-9 shrink-0 items-center justify-center rounded-xl text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200 cursor-pointer"
            title="Attach PDF or photo"
            aria-label="Attach PDF or photo"
          >
            <Reicon name="paperclip" size={18} />
          </button>

          <textarea
            ref={textareaRef}
            rows={1}
            value={inputText}
            onChange={(e) => {
              setInputText(e.target.value);
              e.target.style.height = '0px';
              e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`;
            }}
            onKeyDown={handleKeyDown}
            placeholder="Message…"
            className="h-9 max-h-[120px] min-h-9 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent px-1 py-2 text-[13px] leading-5 text-neutral-900 placeholder:text-neutral-400 focus:outline-none dark:text-neutral-100 [&::-webkit-scrollbar]:hidden [scrollbar-width:none]"
          />

          <button
            onClick={handleSend}
            disabled={(!inputText.trim() && !selectedFile) || sending}
            className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-neutral-900 text-white transition-opacity hover:opacity-90 disabled:opacity-25 dark:bg-neutral-100 dark:text-neutral-900 cursor-pointer"
          >
            {sending ? <Ring className="size-4" /> : <Reicon name="send" size={16} />}
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
        activeConvId ? 'hidden md:flex md:flex-col' : 'flex flex-col animate-in slide-in-from-left-2 duration-200'
      )}>
        {inboxContent}
      </div>
      <div className={cn(
        'flex-1 flex flex-col overflow-hidden min-h-0',
        !activeConvId ? 'hidden md:flex' : 'flex'
      )}>
        {activeConvId ? (
          <motion.div
            key={activeConvId}
            initial={prefersReducedMotion ? false : { opacity: 0.92, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: prefersReducedMotion ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="h-full min-h-0"
          >
            {threadContent}
          </motion.div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 bg-[#fafafa] dark:bg-[#09090b] px-6 text-center">
            <Reillustration
              name={
                currentStudentId === 'admin_mmss'
                  ? 'messages-empty-admin'
                  : userSection === 'Staff'
                    ? 'messages-empty-teacher'
                    : 'messages-empty-student'
              }
              size="md"
            />
            <div className="space-y-1">
              <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
                Pick a conversation
              </h3>
              <p className="text-xs text-neutral-500 dark:text-neutral-400 max-w-[18rem] leading-relaxed">
                Search a classmate or teacher above to start chatting securely.
              </p>
            </div>
          </div>
        )}
      </div>

      {showMembers && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-white dark:bg-[#141417] border border-neutral-200 dark:border-neutral-800 shadow-2xl max-h-[80vh] flex flex-col">
            <div className="flex items-center justify-between gap-3 px-5 pt-4 pb-3 border-b border-neutral-100 dark:border-neutral-800 shrink-0">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-neutral-900 dark:text-neutral-100 truncate">
                  {classGroupLabel(activeConv?.section || userSection)}
                </h3>
                <p className="text-[11px] text-neutral-400 mt-0.5">
                  Classmates on the app
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowMembers(false)}
                className="p-1 rounded-full text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors cursor-pointer"
              >
                <Reicon name="x" size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-2 py-2">
              {membersLoading ? (
                <div className="flex items-center justify-center py-10">
                  <Ring className="size-4 text-neutral-400" />
                </div>
              ) : sectionMembers.length === 0 ? (
                <p className="text-xs text-neutral-400 text-center py-10 px-4">
                  No classmates have joined yet. When they log in, they’ll appear here automatically.
                </p>
              ) : (
                <ul className="space-y-0.5">
                  {sectionMembers.map((m) => (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setShowMembers(false);
                          if (m.id) handleInitiateChat(m);
                        }}
                        className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer"
                      >
                        <ProfileAvatar
                          src={m.profilePictureUrl}
                          name={m.displayName || 'Classmate'}
                          className="size-9 text-[12px]"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-medium text-neutral-900 dark:text-neutral-100 truncate">
                            {m.displayName || 'Classmate'}
                          </p>
                          <p className="text-[11px] text-neutral-500 truncate mt-0.5">
                            Classmate
                          </p>
                        </div>
                        <span className="text-[10px] font-medium text-neutral-400 shrink-0">Message</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="w-full max-w-md rounded-2xl bg-white dark:bg-[#141417] border border-neutral-200 dark:border-neutral-800 shadow-2xl p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">New Message</h3>
              <button onClick={() => { setShowNewModal(false); setSearchQuery(''); setSearchResults([]); }}
                className="p-1 rounded-full text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 transition-colors cursor-pointer">
                <Reicon name="x" size={16} />
              </button>
            </div>
            <div className="relative">
              <Reicon name="search" size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 pointer-events-none" />
              <input type="text" value={searchQuery} onChange={(e) => handleSearch(e.target.value)}
                placeholder="Search by name or student ID across any section..."
                className="w-full text-xs h-9 pl-8 pr-3 rounded-xl border border-neutral-200/80 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 text-neutral-900 dark:text-neutral-100 focus:outline-none focus:ring-1 focus:ring-neutral-400" />
            </div>
            <div className="space-y-1 max-h-56 overflow-y-auto">
              {searching ? (
                <div className="flex items-center justify-center py-4"><Ring className="size-4 text-neutral-400" /></div>
              ) : searchResults.length > 0 ? (
                searchResults.map((u) => (
                  <button key={u.id || `prov-${u.studentId}`} onClick={() => handleInitiateChat(u)}
                    className="w-full text-left flex items-center justify-between px-3 py-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors cursor-pointer group">
                    <div className="flex items-center gap-2.5">
                      <ProfileAvatar
                        src={u.profilePictureUrl}
                        name={userLabel(u)}
                        className="size-7 rounded-xl text-[10px]"
                      />
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs font-semibold text-neutral-900 dark:text-neutral-100 truncate">{userLabel(u)}</span>
                        <span className="text-[10px] text-neutral-400 truncate">
                          {u.provisional
                            ? 'Not on the app yet - tap to message'
                            : 'Start a conversation'}
                        </span>
                      </div>
                    </div>
                    {u.provisional ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-neutral-900 text-white dark:bg-white dark:text-neutral-900">
                        Message
                      </span>
                    ) : u.section ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400 border border-neutral-200/60 dark:border-neutral-700/60">
                        {u.section}
                      </span>
                    ) : null}
                  </button>
                ))
              ) : searchQuery.trim() ? (
                <p className="text-xs text-neutral-400 text-center py-3">
                  No match - type their full student ID to message them anyway.
                </p>
              ) : (
                <p className="text-xs text-neutral-400 text-center py-3">
                  Type a name or student ID - they don’t need to be on the app yet.
                </p>
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
                <Reicon name="x" size={20} />
              </button>
            </div>
            {previewMedia.url.startsWith('blob:') ? (
              <img src={previewMedia.url} alt="" className="max-h-[70vh] w-auto max-w-full object-contain rounded-2xl shadow-md" />
            ) : (
              <AuthenticatedImage
                src={previewMedia.url}
                alt=""
                className="max-h-[70vh] w-auto max-w-full object-contain rounded-2xl shadow-md"
              />
            )}
            <button
              type="button"
              onClick={async () => {
                try {
                  if (previewMedia.url.startsWith('blob:')) {
                    const a = document.createElement('a');
                    a.href = previewMedia.url;
                    a.download = previewMedia.name;
                    a.click();
                    return;
                  }
                  const res = await apiFetch(previewMedia.url);
                  if (!res.ok) throw new Error('Download failed');
                  const blob = await res.blob();
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = previewMedia.name;
                  a.click();
                  URL.revokeObjectURL(url);
                } catch {
                  window.open(previewMedia.url, '_blank', 'noopener,noreferrer');
                }
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 text-xs font-semibold hover:opacity-90 transition-opacity shadow-2xs cursor-pointer"
            >
              <Reicon name="download" size={16} className="w-4 h-4" />
              <span>Download File</span>
            </button>
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
                <Reicon name="x" size={16} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {pinLoading ? (
                <div className="flex justify-center py-10">
                  <Ring className="size-4 text-neutral-400" />
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
                      <Reicon name="file-text" size={16} className="w-4 h-4" />
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
          noticeConfirmingRef.current = false;
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
