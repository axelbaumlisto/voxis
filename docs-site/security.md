---
title: Security
layout: default
---

# Security

Do not commit API keys, access tokens, local SQLite databases, provider definitions, prompts, failed-audio retry files, logs, debug audio, or generated user data.

Runtime credentials must stay local and should be configured through the app settings UI / local config storage. The application does not automatically load API keys from environment variables.

Local runtime data includes `config.db`, `history.db`, `dictionary.txt`, `corrections.db`, `providers.db`, `prompts.db`, `failed_audio/`, `debug/`, `logs/`, and `themes/` under the platform config directory.

## Theme code trust boundary

Overlay themes are executable JavaScript loaded into the app webview. They are trusted by design and are not sandboxed. Only install themes from sources you trust, and review `theme.js` before using third-party themes.

Before publishing, scan for real credentials.

```bash
git grep -InE '(ghp_|gho_|github_pat_|sk-[A-Za-z0-9]|GROQ_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|access[_-]?token|api[_-]?key|secret)' -- . \
  ':(exclude)bun.lock' ':(exclude)bun.lockb'
```

If a real credential was ever committed to a public repository, rotate or revoke it immediately. Removing it from the current tree is not enough if the old Git history is public.
