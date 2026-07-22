# Security

## Secrets and credentials

Do not commit API keys, access tokens, local databases, or generated user data.

Runtime credentials must stay local to the machine and be configured through the app settings UI / local config directory. The application does not automatically load API keys from environment variables.

Keep local config and data files out of commits, including SQLite databases, provider definitions, prompts, failed-audio retry files, logs, debug audio, build outputs, and agent scratch directories.

## Before publishing or pushing

Run a quick secret scan before pushing to a public remote:

```bash
git grep -InE '(ghp_|gho_|github_pat_|sk-[A-Za-z0-9]|GROQ_API_KEY|OPENAI_API_KEY|ANTHROPIC_API_KEY|access[_-]?token|api[_-]?key|secret)' -- . \
  ':(exclude)bun.lock' ':(exclude)bun.lockb'
```

If a real credential was ever committed, rotate/revoke it immediately. Removing it from the current tree is not enough if the old Git history is public.

## Theme code trust boundary

Overlay themes are executable JavaScript modules loaded into the app webview. They are trusted by design and are not a sandbox for untrusted code. Only install or copy themes from sources you trust, and review `theme.js` before using third-party themes.

## Local data

Voxis stores runtime data in the platform config directory, for example:

- `config.db`
- `history.db`
- `dictionary.txt`
- `corrections.db`
- `providers.db`
- `prompts.db`
- `failed_audio/`
- `debug/`
- `logs/`
- user `themes/`

These files are user-local and must not be committed.
