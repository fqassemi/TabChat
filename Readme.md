# TabChat

**Smart bookmarks powered by AI.** Save your open tabs, capture page content, and find anything later with semantic search — 
using your own LLM API key and LangChain. Your data stays local, your API key stays yours.

## What It Does

- **Capture Tabs** — Save any open tab's URL, title, and page content with one click
- **LangChain-Powered Embeddings** — Generates vector embeddings via LangChain using your own LLM API key (OpenAI, Anthropic, 
Cohere, etc.)
- **Semantic Search** — Find saved pages by meaning, not just keywords ("that article about rust memory safety" finds it even 
if those exact words aren't in the title)
- **Bring Your Own Key** — Use your preferred LLM provider. No vendor lock-in.

## Project Structure

```
TabChat/
├── backend/                  # Express + LangChain API server
│   ├── src/
│   │   ├── server.ts          # Main API server (auth, ingest, chat, search)
│   │   ├── db.ts              # PostgreSQL connection pool
│   │   ├── auth/
│   │   │   └── middleware.ts  # JWT create/verify + auth middleware
│   │   ├── repositories/
│   │   │   └── users.ts       # User lookup/creation queries
│   │   └── vectorstores/
│   │       └── FaissSearchEngine.ts  # Per-user FAISS index management
│   ├── package.json
│   └── tsconfig.json
├── extension/                 # Chrome Extension (Manifest V3)
│   ├── manifest.json
│   ├── src/
│   │   ├── popup.ts / popup.html
│   │   ├── overlay.ts          # In-page search overlay (Shadow DOM)
│   │   ├── chatWidget.ts        # In-page chat widget
│   │   └── content.ts
│   ├── dist/                    # Compiled JS (this is what Chrome loads)
│   ├── package.json
│   └── tsconfig.json
├── Contributing.md
├── LICENSE
└── README.md
```

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/fqassemi/TabChat.git
cd TabChat
```

### 2. Backend setup

The backend is an Express server that handles Google login, tab ingestion (via Firecrawl), embeddings, and semantic search 
(via a per-user FAISS index) and requires a PostgreSQL database for users/sessions.

```bash
cd backend
npm install
```

If `npm install` fails due to peer dependency conflicts, run:

```bash
npm install --legacy-peer-deps
```

Create a `.env` file inside `backend/` with the following variables:

```env
# Firecrawl (used to scrape/collect tab content)
FIRECRAWL_API_KEY=your_firecrawl_api_key

# Google OAuth (used for login)
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=your_google_redirect_uri

# JWT (used to sign session tokens)
JWT_SECRET=some_long_random_secret

# PostgreSQL (used to store users & sessions)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=tabchat
DB_USER=postgres
DB_PASSWORD=your_db_password

# Optional, defaults to 8000
PORT=8000
```

Your PostgreSQL database needs at least the following two tables (there is no migration script included yet, so create them 
manually):

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT,
  picture TEXT
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  token TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL
);
```

#### Run in development

From the `backend/` folder:

```bash
npx ts-node src/server.ts
```

This runs the TypeScript source directly (no build step needed) and will start the API on `http://localhost:8000` (or the 
`PORT` you set).

#### Run in production

Compile the TypeScript to JavaScript first, then run the compiled output with Node:

```bash
npm run build      # runs `tsc`, outputs to backend/dist/
node dist/server.js
```

It's recommended to run the compiled server with a process manager such as [pm2](https://pm2.keymetrics.io/) so it stays 
alive and restarts on crashes:

```bash
npm install -g pm2
pm2 start dist/server.js --name tabchat-backend
```

Since the extension talks to the backend over the public internet, you'll also need to expose it via a reverse proxy or 
tunneling tool (e.g. Nginx, Caddy, or ngrok) and make sure the resulting URL matches the `SERVER` constant used in the 
extension (see below).

### 3. Extension (frontend) setup

The extension code lives in `extension/`. A compiled `dist/` folder is included, but if you change any `.ts` file you'll 
need to rebuild it:

```bash
cd extension
npm install
npx tsc
```

Then, before loading the extension, make sure the `SERVER` constant in `extension/src/popup.ts`, `overlay.ts`, and 
`chatWidget.ts` (and their compiled counterparts in `dist/`) points to your backend's public URL, and rebuild if you changed 
it.

To load the extension in Chrome:

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select the `extension/` folder (the one containing `manifest.json`)
4. Pin the TabChat extension to your toolbar

### Usage

1. Click the TabChat icon and log in with Google
2. Enter your OpenAI API key in the popup and save it
3. Click **Collect Tabs** to capture and index your open tabs
4. Use **Search Tabs** for a semantic search overlay, or **Chat with this tab** to ask questions about the current page

## Supported LLM Providers

Any provider supported by LangChain.js, including:

- **OpenAI** — `text-embedding-ada-002`, `text-embedding-3-small`
- **Anthropic** — via LangChain embeddings
- **Cohere** — `embed-english-v3.0`
- **HuggingFace** — Inference API models
- **Others** — Easily extendable through LangChain's provider ecosystem

## Roadmap

- [x] Project setup and documentation
- [x] Basic tab capture (URL + title + content)
- [x] LangChain integration with provider selection
- [x] API key management (secure local storage)
- [x] Embedding generation via LangChain
- [x] Semantic search (FAISS-backed, per user)
- [x] Bulk save all open tabs
- [ ] Tag and folder organization
- [ ] Export/import saved tabs as JSON
- [ ] Dark mode
- [ ] Session snapshots (save & restore groups of tabs)

## Contributing

We welcome contributions! See [CONTRIBUTING.md](Contributing.md) for guidelines.

Check out the [good first issue](https://github.com/fqassemi/TabChat/labels/good%20first%20issue) label for beginner-friendly 
tasks.

## License

MIT — see [LICENSE](LICENSE) for details.