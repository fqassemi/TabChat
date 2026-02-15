# Contributing to TabChat

Thanks for your interest in contributing! TabChat is a beginner-friendly project and we appreciate contributions of all sizes — 
from fixing a typo to adding a major feature.

## Getting Started

1. **Fork** this repo on GitHub
2. **Clone** your fork locally:
   ```bash
   git clone https://github.com/YOUR_USERNAME/TabChat.git
   cd TabChat
   npm install
   ```
3. **Create a branch** for your work:
   ```bash
   git checkout -b feature/your-feature-name
   ```
4. **Build and test** the extension:
   ```bash
   npm run build
   ```
   Then load the `dist/` folder as an unpacked extension in `chrome://extensions`.

## Development Workflow

1. Make your changes in the `src/` directory
2. Run `npm run build` to compile
3. Reload the extension in Chrome to test
4. Commit with a clear message describing what you changed and why
5. Push to your fork and open a **Pull Request** against `main`

## Code Style

- We use ESLint — run `npm run lint` before committing
- Use `const`/`let`, never `var`
- Prefer async/await over raw Promises
- Keep functions small and focused
- Add comments for non-obvious logic, especially around embedding and search code

## What to Work On

- Browse [open issues](https://github.com/YOUR_USERNAME/TabChat/issues), especially those tagged `good first issue`
- If you have a new idea, open an issue first to discuss it before writing code
- Bug fixes and documentation improvements are always welcome

## Design Principles

Keep these in mind when contributing:

- **Local first** — No external API calls. All processing happens in the browser.
- **Privacy by default** — User data never leaves the machine.
- **Simple over clever** — Readable code that new contributors can understand.
- **Manifest V3** — We follow Chrome's latest extension platform.

## Pull Request Guidelines

- Keep PRs focused — one feature or fix per PR
- Reference the related issue number (e.g., "Closes #12")
- Include a brief description of what changed and how to test it
- Make sure the extension loads and runs without errors

## Reporting Bugs

Use the [bug report template](https://github.com/YOUR_USERNAME/TabChat/issues/new?template=bug_report.md) and include your 
Chrome version, OS, and steps to reproduce.

## Questions?

Open a thread in [Discussions](https://github.com/YOUR_USERNAME/TabChat/discussions) — no question is too basic.
