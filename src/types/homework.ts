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

/** Holiday / event from EduSecure CurrentSchoolCalendar.aspx */
export interface SchoolCalendarEvent {
  id: string;
  sourceId?: string | null;
  title: string;
  type: string;
  date: string;
  dateRaw?: string;
  monthLabel?: string | null;
  url?: string | null;
  selected?: boolean;
  updatedAt?: string;
}

export type SchoolNoticeKind = 'circulars' | 'important';

/** Circular or important message pulled from the matching EduSecure page. */
export interface SchoolNotice {
  id: string;
  kind: SchoolNoticeKind;
  type: string;
  date: string;
  title?: string | null;
  content: string;
  attachment?: string | null;
  attachmentName?: string | null;
}

export type ViewType =
  | 'today'
  | 'recent'
  | 'all'
  | 'calendar'
  | 'circulars'
  | 'important'
  | 'exams'
  | 'attachments'
  | 'completed'
  | 'classwork'
  | 'requests'
  | 'leave'
  | 'messages'
  | 'settings'
  | 'developers'
  | 'admin-overview'
  | 'admin-students'
  | 'admin-teachers'
  | 'admin-moderation'
  | 'admin-alerts'
  | 'admin-reports'
  | 'teacher-overview'
  | 'teacher-assignments'
  | 'teacher-attendance'
  | 'teacher-duties'
  | 'teacher-announcements'
  | 'teacher-parents'
  | 'teacher-students'
  | 'teacher-leave';
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
  isSeen?: boolean;
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
  otherUser: { id: string; studentId?: string; displayName?: string | null; profilePictureUrl?: string | null; section: string } | null;
  section?: string | null;
  memberCount?: number;
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
  senderProfilePictureUrl?: string | null;
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
