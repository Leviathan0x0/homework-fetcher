# 📚 MMSS Mohali — Student Portal & Homework Fetcher

A fast, modern, and calm student portal for **MMSS Mohali**. Built for seamless homework tracking, classwork management, peer requests, and real-time student messaging.

![React 19](https://img.shields.io/badge/React-19.0-blue?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript)
![Vite](https://img.shields.io/badge/Vite-6.1-purple?logo=vite)
![Tailwind CSS v4](https://img.shields.io/badge/Tailwind_CSS-v4.0-38bdf8?logo=tailwindcss)
![Express.js](https://img.shields.io/badge/Express.js-5.2-green?logo=express)
![Drizzle ORM](https://img.shields.io/badge/Drizzle_ORM-0.45-yellow?logo=sqlite)

---

## ✨ Features

- 📅 **Homework Dashboard**: Organizes daily homework assignments cleanly by date and subject. Features real-time subject detection, completion tracking, date filtering, and search.
- ⚡ **Batch Loading & Smooth Pagination**: Fast card loading with dedicated progress spinners and pagination memory to handle large volumes of assignments without lag.
- 💬 **Peer-to-Peer Messages**: In-app direct chat between classmates with custom display names, unread badges, document & image attachment sharing, message deletion, and image lightbox previewing.
- 🤝 **Homework Help Requests**: Submit and fulfill peer homework assistance requests.
- 📁 **Classwork Management**: Classwork uploads and attachment file previewing with automatic client-side image compression.
- 📱 **Mobile & PWA Ready**: Native-like Progressive Web App experience with custom mobile navigation, responsive safe-area adjustments, and guided iOS/Android home screen installation.
- ⬆️ **Scroll Teleportation**: One-click floating teleport buttons (scroll-to-top in homework lists, scroll-to-bottom in active chat threads).
- 🌙 **Dark Mode & Liquid Glass UI**: Multi-theme support (Light / Dark / System) crafted with modern Tailwind CSS v4 liquid-glass design aesthetics and smooth micro-animations.

---

## 🛠️ Tech Stack

### Frontend
- **Framework**: [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- **Build Tool**: [Vite 6](https://vitejs.dev/)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/) + CSS Variables
- **Icons**: [Phosphor Icons](https://phosphoricons.com/) & [Lucide React](https://lucide.dev/)
- **UI Components**: Radix UI, Base UI, DND Kit

### Backend
- **Server**: [Express 5](https://expressjs.com/) (Node.js)
- **Database**: SQLite / LibSQL with [Drizzle ORM](https://orm.drizzle.team/)
- **Authentication**: HTTP-only cookie session authentication
- **File Uploads**: Multer file handling with attachment storage
- **Security**: Helmet headers, CORS origin protection, per-instance rate limiting

---

## 🚀 Quick Start

### Prerequisites
- **Node.js**: v18.0.0 or higher
- **npm**: v9.0.0 or higher

### Installation

1. **Clone the repository**:
   ```bash
   git clone https://github.com/Leviathan0x0/homework-fetcher.git
   cd homework-fetcher
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Set up environment variables**:
   Create a `.env` file in the project root (or copy `.env.example` if available):
   ```env
   PORT=3000
   SESSION_SECRET=your_secure_random_session_secret_here
   ALLOWED_ORIGINS=http://localhost:5173,http://localhost:3000
   ```

4. **Run in development mode**:
   ```bash
   # Terminal 1: Start backend API server
   npm start

   # Terminal 2: Start frontend Vite development server
   npm run dev
   ```

5. **Open in browser**:
   Navigate to `http://localhost:5173` (Vite dev server) or `http://localhost:3000` (Integrated Express app).

---

## 📜 NPM Scripts

| Script | Command | Description |
| :--- | :--- | :--- |
| `npm run dev` | `vite` | Launch Vite development server with HMR |
| `npm run build` | `vite build` | Transpile and bundle production assets into `dist/` |
| `npm run preview` | `vite preview` | Locally preview production bundle build |
| `npm start` | `node server.js` | Launch Node.js Express server |

---

## 🏗️ Project Architecture

```
homework-fetcher/
├── public/                # Static assets (logo, favicon, CSS tokens, PWA manifest)
├── server/                # Express backend modular structure
│   ├── auth/              # Cookie session management & cryptographic secrets
│   ├── db/                # Drizzle ORM client & SQLite database schema
│   ├── routes/            # Express REST API endpoints (auth, homework, messaging, etc.)
│   └── limits.js          # Security rate limiters
├── src/
│   ├── components/        # UI Views & Components (AppShell, HomeworkCard, MessagesView, etc.)
│   ├── hooks/             # Custom React Hooks (useHomework, usePagination, etc.)
│   ├── services/          # API services & client-side HTTP fetch wrappers
│   ├── types/             # TypeScript type interfaces
│   └── utils/             # Helper utilities (date formatting, subject detection, image compression)
├── server.js              # Server entry point
├── vite.config.ts         # Vite configuration
└── package.json           # Project dependencies & scripts
```

---

## 🔒 Security & Privacy

- **Session Security**: Session tokens are stored in strict `HTTP-Only` cookies with `SameSite=Lax` protection against CSRF.
- **Request Safety**: Secured with `Helmet` security headers and origin verification.
- **Privacy First**: Student display names are customizable, and message deletion removes stored attachments securely.

---

## 📄 License

Distributed under the **ISC License**. See `package.json` for details.
