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

## Quick Start

### Install from Source

```bash
git clone https://github.com/fqassemi/TabChat.git
cd TabChat
npm install
npm run build
```

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select the `dist/` folder
4. Pin the TabChat extension to your toolbar

### Configuration

1. Click the TabChat icon and go to **Settings**
2. Select your LLM provider (OpenAI, Anthropic, Cohere, etc.)
3. Enter your API key
4. Choose your preferred embedding model

Your API key is stored locally in Chrome's secure storage and is never sent anywhere except directly to your chosen provider.

### Usage

1. Click the TabChat icon to open the popup
2. Hit **Save Tab** to capture the current page
3. Type a natural language query in the search bar to find saved pages
4. Click any result to reopen the tab

## Tech Stack

| Component | Technology |
|---|---|
| Extension | Chrome Manifest V3 |
| LLM Framework | LangChain.js |
| Embeddings | Your choice via LangChain (OpenAI, Cohere, HuggingFace, etc.) |
| Storage | IndexedDB (via `idb`) |
| Search | Cosine similarity over stored vectors |
| Build | Webpack (or Vite) |

## Project Structure

```
TabChat/
├── src/
│   ├── manifest.json            # Chrome extension manifest v3
│   ├── background/
│   │   └── service-worker.js    # Tab capture & indexing
│   ├── popup/
│   │   ├── popup.html           # Search & saved tabs UI
│   │   ├── popup.js
│   │   └── popup.css
│   ├── content/
│   │   └── extractor.js         # Page content extraction
│   ├── settings/
│   │   ├── settings.html        # API key & provider config
│   │   └── settings.js
│   └── lib/
│       ├── storage.js           # IndexedDB wrapper
│       ├── llm.js               # LangChain LLM/embedding setup
│       └── search.js            # Semantic similarity search
├── docs/
│   └── ARCHITECTURE.md
├── .github/
│   ├── ISSUE_TEMPLATE/
│   │   ├── bug_report.md
│   │   └── feature_request.md
│   └── PULL_REQUEST_TEMPLATE.md
├── CONTRIBUTING.md
├── LICENSE
└── README.md
```

## Supported LLM Providers

Any provider supported by LangChain.js, including:

- **OpenAI** — `text-embedding-ada-002`, `text-embedding-3-small`
- **Anthropic** — via LangChain embeddings
- **Cohere** — `embed-english-v3.0`
- **HuggingFace** — Inference API models
- **Others** — Easily extendable through LangChain's provider ecosystem

## Roadmap

- [x] Project setup and documentation
- [ ] Basic tab capture (URL + title + content)
- [ ] IndexedDB storage layer
- [ ] LangChain integration with provider selection
- [ ] API key management (secure local storage)
- [ ] Embedding generation via LangChain
- [ ] Semantic search with cosine similarity
- [ ] Bulk save all open tabs
- [ ] Tag and folder organization
- [ ] Export/import saved tabs as JSON
- [ ] Dark mode
- [ ] Session snapshots (save & restore groups of tabs)

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

Check out the [good first issue](https://github.com/fqassemi/TabChat/labels/good%20first%20issue) label for beginner-friendly 
tasks.

## License

MIT — see [LICENSE](LICENSE) for details.
