# 🎯 Autonomous AI Job Intelligence & Alert Engine

An autonomous, end-to-end AI-powered job discovery, evaluation, and alert platform tailored specifically to candidate resume profiles. Built with **TypeScript**, **Google Gemini 3.1 Flash**, **Firecrawl API**, **Drizzle ORM**, and **Telegram Bot API**.

---

## 🏗️ System Architecture

The platform operates as a continuous intelligence pipeline that discovers companies, crawls job listings across multiple tiers, evaluates fit using LLM reasoning, and dispatches rich real-time alerts.

```mermaid
flowchart TD
    subgraph Candidate Setup
        A[resume.txt] -->|Parsed by Gemini 3.1| B[Structured Candidate Profile]
    endif

    subgraph Phase 1: Company Discovery & Targets
        C[Startup Directory Scanner / YC / HN] -->|Discovery Agent| D[(Companies Database)]
        E[Curated Company Seed List] --> D
    end

    subgraph Phase 2: Hybrid Crawling Infrastructure
        D --> F{Priority & Due Check}
        F -->|Native ATS APIs| G[Greenhouse / Lever / Ashby APIs]
        F -->|AI Site Mapping| H[Firecrawl Engine /v1/map & /v1/scrape]
        F -->|Dynamic SPA Browser| I[Playwright Headless Chromium]
        F -->|Aggregators| J[LinkedIn / RemoteOK / YC RSS]
    end

    subgraph Phase 3: Processing & Intelligence Engine
        G & H & I & J --> K[MD5 Deduplication & Job Storage]
        K --> L[Rule-Based Pre-Filtering]
        L -->|Passed Jobs| M[Gemini AI Matching Engine]
        B --> M
        M -->|Multi-Dimensional Scoring| N[Priority & Interview Odds Calculator]
    end

    subgraph Phase 4: Real-Time Alerts & Outreach
        N -->|High Priority Match| O[Rich Telegram Notification Card]
        N -->|Match Webhook| P[n8n Automation Router]
        M -->|On-Demand| Q[Tailored Cold Email / LinkedIn Outreach]
    end
```

---

## 🤖 How AI Powers This System

### 1. Structured Candidate Profile Parsing (`geminiService.ts`)
When a `resume.txt` is updated, the system feeds raw text into **Gemini 3.1 Flash** using strict JSON schema output. It extracts:
- Core technical skills & languages
- Experience & internship history
- Projects & design/product achievements

### 2. Multi-Dimensional Job Matching Engine (`matcher.ts`)
Instead of primitive keyword matching, every crawled job undergoes a deep AI evaluation against the candidate's exact background. Gemini evaluates:
- **Match Score (0-100):** Deep context analysis of required vs. candidate capabilities.
- **Interview Probability:** Categorized as `High`, `Medium`, or `Low`.
- **Missing Skills & Gaps:** Explicit list of missing technologies to highlight or prepare.
- **Actionable Resume Tips:** Custom advice on which projects or achievements to emphasize when applying.
- **Estimated Competition & Salary Range:** Algorithmic and LLM estimations.

### 3. Priority Score Formula
The engine calculates an overall **Priority Score (0-100)** incorporating job freshness, hiring momentum, company health, ATS confidence, and competition multipliers:

$$\text{Priority Score} = \text{Score} \times \left(\frac{\text{Momentum}}{100}\right) \times \left(\frac{\text{Health}}{100}\right) \times \text{FreshnessMultiplier} \times \text{SizeMultiplier} \times \text{IndiaBoost}$$

### 4. Automated Startup Discovery Agent (`discoveryAgent.ts`)
Scans emerging tech ecosystems (Hacker News, YC startup lists) to automatically discover unmonitored startups, identify their ATS type, and register them into the database for continuous monitoring.

### 5. Tailored Outreach Generation
Generates custom-tailored outreach messages on demand for matched roles:
- **Cold Email:** Targeted pitch directly addressing the hiring manager.
- **LinkedIn Request:** Concise, personalized connection note (<300 chars).
- **Referral Request:** Warm message for mutual connections.

---

## 🔄 Evolution of the Crawling Architecture

Scraping job sites accurately is notoriously difficult due to dynamic SPAs, custom career page layouts, and anti-bot protection (Cloudflare). This system uses a **4-Tier Hybrid Crawling Engine**:

| Tier | Crawler Type | Target Platforms | Key Advantage |
| :--- | :--- | :--- | :--- |
| **Tier 1** | **Native Public ATS APIs** | Greenhouse, Lever, Ashby | ⚡ Sub-second response times, 100% structured JSON data, **zero API cost**. |
| **Tier 2** | **Firecrawl AI Engine** | Custom Career Sites, Workday, SPA Portals | 🛡️ Uses Firecrawl `/v1/map` to auto-discover job links and `/v1/scrape` to bypass anti-bot walls, returning clean Markdown without maintaining fragile DOM selectors. |
| **Tier 3** | **Playwright Browser Automation** | Complex JavaScript Sites (Fallback) | 🤖 Headless Chromium automation with stealth user-agent context for JS-rendered career portals when Firecrawl key is not active. |
| **Tier 4** | **RSS & Global Aggregators** | RemoteOK, YC Jobs RSS, Global ATS Boards | 🌐 Scrapes high-volume job aggregators for remote and early-stage startup roles. |

---

## 📱 Rich Real-Time Telegram Alerts

When a fresh job match achieves a **Priority Score $\ge 35$**, the system dispatches an analytics-rich alert card to Telegram:

```
🔥 NEW HIGH-MATCH JOB ALERT!

💼 Role: Software Development Engineer - Full Stack
🏢 Company: Razorpay
📍 Location: Bangalore, India / Hybrid
💰 Salary: ₹18,000,000 - ₹24,000,000 PA
⚙️ ATS System: GREENHOUSE

━━━━━━━━━━━━━━━━━━━━━
📊 MATCH ANALYTICS
🎯 Match Score: 88/100 [🟩🟩🟩🟩🟩🟩🟩🟩⬜⬜]
⚡ Priority Score: 92/100
🔮 Interview Odds: 🔥 High
👥 Competition: < 50 applicants
📈 Company Health: 90/100 | 🚀 Momentum: 85/100

━━━━━━━━━━━━━━━━━━━━━
💡 WHY YOU'RE A FIT:
Strong alignment with TypeScript, React, Node.js, and PostgreSQL indexing experience.

⚠️ KEY SKILL GAPS:
• Redis caching
• Kafka message queues

📝 RESUME TIP:
Emphasize your database query optimization achievements in your application cover letter.

━━━━━━━━━━━━━━━━━━━━━
👉 CLICK HERE TO APPLY NOW
```

---

## 🛠️ Tech Stack & Ecosystem

- **Language & Runtime:** TypeScript, Node.js (v20+)
- **LLM Engine:** Google Gemini API (`@google/genai` using `gemini-3.1-flash-lite`)
- **Web Intelligence & Scraping:** Firecrawl API (`https://www.firecrawl.dev`), Playwright (`chromium`)
- **Database & ORM:** Drizzle ORM, SQLite (`local.db`) / Neon Serverless PostgreSQL
- **Automation & CLI:** Commander.js, Node-Cron, Telegram Bot API, n8n Webhooks
- **DevOps & CI/CD:** Docker, Docker Compose, GitHub Actions

---

## 🚀 Getting Started & Local Setup

### 1. Prerequisites
- **Node.js:** v20 or higher
- **Gemini API Key:** Free key from [Google AI Studio](https://aistudio.google.com/)
- **Firecrawl API Key (Optional):** Free key from [firecrawl.dev](https://www.firecrawl.dev/)
- **Telegram Bot Token (Optional):** Created via `@BotFather` on Telegram

### 2. Installation
```bash
# Clone the repository
git clone https://github.com/prakharp18/workflow.git
cd workflow

# Install dependencies
npm install

# Install Playwright browser binaries
npx playwright install chromium --with-deps
```

### 3. Environment Configuration
Create a `.env` file in the project root:
```env
DATABASE_URL=file:local.db
GEMINI_API_KEY=AIzaSyYourGeminiApiKeyHere
FIRECRAWL_API_KEY=fc-YourFirecrawlApiKeyHere
TELEGRAM_BOT_TOKEN=123456789:YourTelegramBotToken
TELEGRAM_CHAT_ID=YourTelegramChatId
N8N_WEBHOOK_URL=http://localhost:5678/webhook/job-alert
RESUME_PATH=resume.txt
```

### 4. Database Setup & Seeding
```bash
# Compile TypeScript
npm run build

# Push database migrations
npm run db:migrate

# Seed database with target startups
node dist/cli.js seed
```

### 5. Running the Engine
```bash
# Run a one-time manual synchronization and evaluation
node dist/cli.js sync

# Start continuous background monitoring daemon
node dist/cli.js watch
```

---

## 💻 CLI Command Reference

| Command | Description |
| :--- | :--- |
| `node dist/cli.js sync` | Manually triggers full global A-to-Z job crawl, deduplication, and AI evaluation. |
| `node dist/cli.js seed` | Seeds database with curated target tech companies and ATS tokens. |
| `node dist/cli.js discover` | Runs the AI startup discovery agent to find new companies on YC & HN. |
| `node dist/cli.js watch` | Launches background cron worker for continuous scheduled crawling. |

---

## 🐳 Docker Setup

Run using Docker Compose:
```bash
docker-compose up -d --build
```

---

## 📄 License

ISC License. Built for autonomous job discovery and intelligent career acceleration.
