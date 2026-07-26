# 📚 Homework Fetcher — Complete Feature Showcase

Welcome to **Homework Fetcher**, a modern, high-performance web application designed to fetch, organize, and enrich school homework, classwork, exam schedules, and peer communication for EduSecure users.

---

## 🌟 Key Highlights & Dashboard Views

### 🗓️ 1. Smart Homework Management Views
- **Today’s View (`TodayView`)**: Immediate focus area displaying pending homework due or assigned today, prioritized for student workflow.
- **Recent View (`RecentView`)**: Groups assignments from the past 7 days chronologically with day-by-day headers.
- **All Homework View (`AllHomeworkView`)**: Comprehensive searchable archive supporting subject filtering, date filtering, and load-more batch pagination.
- **Completed View (`CompletedView`)**: Dedicated archive for reviewed and finished assignments.
- **Calendar View (`CalendarView`)**: Interactive monthly/weekly calendar grid displaying homework density per day.
- **Classwork Hub (`ClassworkView`)**: View daily classwork entries with interactive analytics charts and structured data tables.
- **Exam & Test Schedules (`ExamsView`)**: Exam dates, syllabus breakdowns, and preparation timetables.
- **Central Attachments Gallery (`AttachmentsView`)**: Aggregate list of all PDF worksheets, document links, and image attachments.

---

## 🤖 Subject Intelligence & AI Detection Engine

Homework Fetcher automatically classifies unstructured school diary entries into 14+ distinct subjects:

- **Supported Subjects**: Mathematics, Physics, Chemistry, Biology, Science, English, Hindi, Punjabi, History, Social Science, Computers, Art, General Knowledge, French, and School Diary.
- **5-Priority Detection Hierarchy**:
  1. **Priority 1**: Explicit EduSecure subject tags.
  2. **Priority 2 & 3**: Content-first text detection (e.g. *"Bring History book"* → **History**).
  3. **Priority 4**: Classwork (CW) type fallback signal.
  4. **Priority 5**: Language-specific fallback (Punjabi, Hindi, French).
  5. **Default**: General School Diary.
- **Shortlink & Tracking Normalization**: Normalizes dynamic EduSecure tracking URLs (`http://tiny.edusecure.in/...`) to eliminate duplicate database rows and guarantee deterministic hashing.

---

## 📝 Interactive Task & Study Tools

- **One-Tap Task Completion**: Mark assignments completed with instant optimistic UI updates synced to SQLite (`homework_user_state`).
- **Personal Student Notes**: Add, edit, or clear personal study notes and reminders on any homework card.
- **In-App Document Previewer (`FilePreviewSidebar`)**: View PDFs, images, and external links directly within the app without leaving your workspace.
- **Instant Search Bar (`SearchBar`)**: Real-time substring search across homework text, subjects, and dates.
- **Subject Pills & Quick Filters (`SubjectFilterPills`)**: One-tap subject filtering pills.

---

## 🤝 Peer Requests & Community Board (`RequestsView`)

- **Help Requests**: Ask classmates for missing assignment details, notes, or photo uploads.
- **Upvoting System**: Upvote peer requests to highlight high-priority homework queries.
- **Secure Request Management**: Authorized deletion allowing users to delete their own submitted requests with server-side validation.

---

## 💬 1-on-1 Student Messaging & Safety (`MessagesView`)

- **Peer Conversations**: Direct 1-on-1 messaging between students.
- **School Safety Monitoring Notice (`MonitoringNoticeDialog`)**:
  - Displays mandatory school authority monitoring policy regarding abuse, harassment, and non-academic conduct.
  - Features a mandatory 5-second countdown timer before the `OK` button unlocks.
  - Server-backed notice security token (`noticeToken`) preventing client-side countdown bypasses.

---

## 🔔 Notifications & Real-Time Alerts

- **Notification Center (`NotificationPopover`)**: Popover bell indicator showing unread announcements, new peer requests, and assignment updates.

---

## 📱 Mobile-First Design & PWA Integration

- **Progressive Web App (PWA)**: Installable as a native app on iOS, Android, macOS, and Windows (`manifest.json` & `PWAInstallPrompt`).
- **Official Branding Icons**: Pixel-perfect 192x192, 512x512, maskable, and Apple touch icons derived directly from the official school logo.
- **Mobile Navigation (`MobileNavigation`)**: Responsive bottom navigation bar with filled active Phosphor icons.
- **Dark & Light Mode Themes**: Customizable aesthetic themes and app settings (`SettingsModal`).

---

## ⚡ Backend Architecture & Performance

- **Fast Node.js / Express Server**: RESTful API service handling authentication, homework caching, messaging, and requests.
- **SQLite Database with Drizzle ORM**: Persistent user isolation, completion states, personal notes, and message history.
- **Background Sync & Caching**: Automated background fetching with zero-latency cached reads.
