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
  studentId: string;
  section: string;
  subject: string;
  title?: string | null;
  date: string;
  fileUrl: string;
  originalFilename: string;
  fileSize: number;
  mimeType: string;
  createdAt: string;
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

export interface Conversation {
  id: string;
  otherUser: { id: string; studentId: string; section: string } | null;
  lastMessagePreview?: string;
  lastMessageAt?: string;
  unreadCount: number;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  content: string;
  createdAt: string;
  isMine: boolean;
}
