# 📚 MMSS Mohali — Student Portal & Homework Hub

> **A high-performance, calm, and modern student experience for MMSS Mohali.**  
> Track daily homework, access classwork files, request peer assistance, and chat with classmates — delivered with sub-second instant load times on web, mobile, and desktop.

**Live app:** [https://mmss64.vercel.app](https://mmss64.vercel.app)

![Version](https://img.shields.io/badge/version-0.5.0-4f46e5)
[![CI](https://github.com/Leviathan0x0/homework-fetcher/actions/workflows/ci.yml/badge.svg?branch=kiaan)](https://github.com/Leviathan0x0/homework-fetcher/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Leviathan0x0/homework-fetcher/actions/workflows/codeql.yml/badge.svg?branch=kiaan)](https://github.com/Leviathan0x0/homework-fetcher/actions/workflows/codeql.yml)
![React 19](https://img.shields.io/badge/React-19.0-blue?logo=react)
![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue?logo=typescript)
![Vite](https://img.shields.io/badge/Vite-6.1-purple?logo=vite)
![Tailwind CSS v4](https://img.shields.io/badge/Tailwind_CSS-v4.0-38bdf8?logo=tailwindcss)
![Express.js](https://img.shields.io/badge/Express.js-5.2-green?logo=express)
![SQLite](https://img.shields.io/badge/SQLite-Drizzle_ORM-yellow?logo=sqlite)
![PWA Ready](https://img.shields.io/badge/PWA-Installable-indigo)

---

## 🔗 Try the Live App

Open the deployed app at **[mmss64.vercel.app](https://mmss64.vercel.app)**.
The portal requires a valid MMSS student or teacher account. A private demo-teacher account is
enabled for reviewers; request its credentials separately rather than publishing the password.

![MMSS Mohali login screen](public/demo-screenshot.png)

## 🤖 AI Use Disclosure

The app uses OpenAI's **Moderation API** (`omni-moderation-latest`) to check text and uploaded
images in Messages, Requests, and Classwork for abusive, unsafe, or NSFW content. This is a
content-safety filter, not a chatbot or a homework-generation feature. Deterministic profanity
and file-type checks run locally as a second layer.

---

## ✅ Release Quality — v0.5.0

Every push and pull request is checked by GitHub Actions before it should be merged:

- **Node.js 22 and 24:** verifies both supported runtime lines.
- **Static checks:** ESLint, React Hooks rules, and strict TypeScript.
- **Automated tests:** Node service tests, React interaction tests, and a real Chromium login smoke test.
- **Production build:** Vite must compile successfully and remain inside the entry-bundle budget.
- **Security:** high/critical npm advisories fail CI; production dependencies are audited separately.
- **Code scanning:** CodeQL analyzes JavaScript and TypeScript on pushes, pull requests, and weekly schedules.
- **Dependency maintenance:** Dependabot checks npm packages and GitHub Actions every week.

> Workflows report failures automatically, but repository administrators must enable branch protection and mark the documented checks as required to actually block an unsafe merge.

---

## ✨ Core Product Showcase

### ⚡ Sub-Second Instant Homework Engine
- **Instant Response (< 15ms)**: Powered by a Stale-While-Revalidate architecture and SQLite local persistence. Students never sit staring at a 10-second loading screen — homework renders immediately on launch.
- **Login Pre-parsing**: Background parser syncs school portal announcements during authentication so assignments are ready before the main view even opens.

### 📅 Smart Homework Diary
- **Subject Intelligence**: Automatic subject detection, color-coded badges, assignment status tracking, and date-range filtering.
- **Attachment Previews**: Inline file previews for images, PDF notes, and worksheets with auto-compression.
- **Smooth Pagination**: Infinite batch card loading with memory retention so browsing past weeks of homework remains butter-smooth.

### 💬 Classmate Messaging & Collaboration
- **Direct Peer Chat**: High-speed, section-based direct messaging with classmates.
- **Rich Media & Lightbox**: Send notes, images, and documents with built-in full-screen image lightbox view.
- **Unread Counter & Scroll Teleportation**: Real-time unread badges and sticky scroll teleport buttons for instant navigation to the latest message.

### 🤝 Section Help & Classwork Sharing
- **Help Requests**: Post and fulfill homework help requests with fellow section students.
- **Classwork Storage**: Upload, organize, and browse shared class notes by subject.

### 📱 Installable PWA Experience
- **Cross-Platform**: Install directly to home screen or desktop on **iOS (Safari)**, **Android (Chrome)**, and **Computer (Chrome / Edge / Safari)**.
- **High-Res Branding**: 1024x1024 vector crisp branding assets with squircle safe-zone padding for macOS Dock and mobile app grids.
- **Guided Setup**: Built-in interactive device installation guide with step-by-step instructions for every device.

### 🎨 Premium Design System
- **Dark & Light Modes**: Beautiful dark/light theme switching with automatic system preference detection.
- **Liquid Glass Aesthetics**: Modern Tailwind CSS v4 design system with smooth micro-animations, solid logo containers, and clean sans-serif typography.

---

## 🎨 Design & Experience Principles

- **Zero Monospace Clutter**: Enforces clean, high-legibility sans-serif typography across all views and modals.
- **Solid White Logo Wrappers**: Brand containers maintain solid white backing across light and dark themes for consistent contrast.
- **Indigo Accent Palette**: Styled with blue-sided Indigo (`#4f46e5`) accent colors for a focused, calm UI atmosphere.

---

## 🛠️ Architecture & Technology Stack

| Layer | Technology |
| :--- | :--- |
| **Frontend** | React 19, TypeScript 5.7, Vite 6 |
| **Styling** | Tailwind CSS v4, Lucide React, Phosphor Icons |
| **UI Components** | Radix UI, Base UI, DND Kit, Recharts |
| **Backend API** | Express 5 (Node.js), Cookie Authentication |
| **Database** | SQLite, LibSQL, Drizzle ORM |
| **Security** | HTTP-Only Cookies, Helmet, CORS, Rate Limiters, CodeQL |
| **Testing** | Node Test Runner, Vitest, Testing Library, Playwright |
| **Observability** | Sentry, Vercel Analytics |
| **Automation** | GitHub Actions, Dependabot |

---

## 🚀 Developer & Local Setup

<details>
<summary><strong>Click to expand installation and development setup instructions</strong></summary>

### Prerequisites
- Node.js v22+ and npm v10+

### Quick Start
```bash
# 1. Clone the repo
git clone https://github.com/Leviathan0x0/homework-fetcher.git
cd homework-fetcher

# 2. Install the exact locked dependency tree
npm ci

# 3. Start the Vite development server
# The Vite plugin mounts the Express API for local development.
npm run dev
```

Open `http://localhost:5173` in your browser.

### NPM Commands
| Command | Purpose |
| :--- | :--- |
| `npm run dev` | Launch Vite with the Express API mounted for local development |
| `npm start` | Launch the standalone Express server |
| `npm run lint` | Run ESLint across frontend, server, tests, and configuration |
| `npm run typecheck` | Run strict TypeScript checks |
| `npm test` | Run Node service tests and React interaction tests |
| `npm run test:e2e` | Run the Chromium login smoke test |
| `npm run build` | Build production assets and enforce the bundle budget |
| `npm run audit` | Reject high or critical dependency advisories |
| `npm run audit:production` | Audit production dependencies separately |
| `npm run check` | Run the complete non-browser quality gate used by CI |

</details>

### Browser test setup

Install Chromium once before running the Playwright suite locally:

```bash
npx playwright install chromium
npm run test:e2e
```

CI installs Chromium automatically and uploads Playwright screenshots, traces, and error context when a smoke test fails.

---

## 🧪 Quality Gates

### Test layers

| Layer | Location | What it protects |
| :--- | :--- | :--- |
| **Service tests** | `test/` | Authentication, parsing, caching, moderation, notices, and attachment streaming |
| **React tests** | `src/test/` | Login validation, credential submission, role switching, and password recovery |
| **Browser smoke test** | `e2e/` | The browser-rendered login flow in Chromium |

### Bundle limits

`scripts/check-bundle-size.mjs` inspects the generated module entry after every production build. CI fails when it exceeds either limit:

- **700 KiB raw**
- **215 KiB gzip**

### Required merge checks

After these workflows are pushed, configure GitHub branch protection for the protected branch and require:

- `Node 22 quality gate`
- `Node 24 quality gate`
- `Chromium smoke test`
- `Analyze JavaScript and TypeScript`

The workflow definitions live in `.github/workflows/ci.yml` and `.github/workflows/codeql.yml`.

---

## 🚢 Deployment

The production frontend and API are configured for Vercel at:

**[https://mmss64.vercel.app](https://mmss64.vercel.app)**

See [`DEPLOYMENT.md`](DEPLOYMENT.md) for database, secrets, allowed origins, uploads, and serverless-hosting configuration. Never commit `.env` files or production credentials.

---

## 📄 License

Distributed under the **ISC License**. See `package.json` for details.
