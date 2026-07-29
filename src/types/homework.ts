export interface HomeworkEntry {
  id?: string;
  type: string;
  date: string;
  subject?: string;
  homework: string;
  attachment: string | null;
  completed?: boolean;
  note?: string | null;
  updatedAt?: string;
}

export interface FetchHomeworkResponse {
  count: number;
  homework: HomeworkEntry[];
  isStale?: boolean;
  isRefreshing?: boolean;
  sessionExpired?: boolean;
  warning?: string;
  error?: string;
  code?: string;
}

export interface ClassworkEntry {
  id: string;
  studentId?: string;
  section?: string;
  subject: string;
  title?: string | null;
  date?: string;
  fileUrl: string;
  filename?: string;
  originalFilename?: string;
  fileSize: number;
  mimeType: string;
  createdAt: string;
  fileId?: string | null;
  uploadedBy?: string;
  uploaderId?: string;
  isOwner?: boolean;
}

export type ViewType = 'today' | 'recent' | 'all' | 'calendar' | 'exams' | 'attachments' | 'completed' | 'classwork' | 'requests' | 'messages' | 'settings';
export type ThemeMode = 'light' | 'dark' | 'system';
export type SessionStatus = 'connected' | 'expired' | 'disconnected';

export interface SubjectInfo {
  name: string;
  badgeClass: string;
  bgStyle: string;
  textStyle: string;
  /** Left-edge accent on homework cards. */
  accentBorderClass: string;
}

export interface SectionRequest {
  id: string;
  studentId: string;
  section: string;
  category?: string | null;
  title: string;
  content: string;
  status: 'open' | 'completed';
  createdAt: string;
  creatorUserId?: string;
  isOwner?: boolean;
}

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body?: string;
  link?: string;
  referenceId?: string;
  isRead: number;
  createdAt: string;
}

export interface PinnedHomework {
  id: string;
  subject: string;
  date: string;
  content: string;
  attachmentUrl?: string | null;
  type?: string;
}

export interface Conversation {
  id: string;
  type?: 'dm' | 'section';
  otherUser: { id: string; studentId: string; displayName?: string | null; section: string } | null;
  section?: string | null;
  lastMessagePreview?: string;
  lastMessageAt?: string;
  unreadCount: number;
  muted?: boolean;
  pinnedHomeworkId?: string | null;
  pinnedHomework?: PinnedHomework | null;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  senderStudentId?: string;
  senderName?: string | null;
  content: string;
  /** Display body with request marker stripped (set by mapMessage). */
  displayContent?: string;
  /** Request this message is helping with (embedded in content). */
  requestRef?: {
    id: string;
    title: string;
    content: string;
    category?: string | null;
  } | null;
  attachmentUrl?: string | null;
  originalFilename?: string | null;
  mimeType?: string | null;
  replyTo?: {
    id: string;
    senderId: string;
    senderName?: string | null;
    content: string;
    attachmentUrl?: string | null;
  } | null;
  readBy?: Array<{ userId: string; readAt: string }>;
  createdAt: string;
  isMine: boolean;
}
