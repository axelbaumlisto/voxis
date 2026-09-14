PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE llm_providers (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                api_url TEXT NOT NULL,
                models TEXT NOT NULL,
                default_model TEXT NOT NULL,
                builtin INTEGER DEFAULT 0
            );
INSERT INTO llm_providers VALUES('groq','Groq','https://api.groq.com/openai/v1/chat/completions','[{"id":"llama-3.3-70b-versatile","name":"Llama 3.3 70B"},{"id":"llama-3.1-8b-instant","name":"Llama 3.1 8B Instant"},{"id":"mixtral-8x7b-32768","name":"Mixtral 8x7B"}]','llama-3.3-70b-versatile',1);
INSERT INTO llm_providers VALUES('openai','OpenAI','https://api.openai.com/v1/chat/completions','[{"id":"gpt-4o","name":"GPT-4o"},{"id":"gpt-4o-mini","name":"GPT-4o Mini"},{"id":"gpt-4-turbo","name":"GPT-4 Turbo"},{"id":"gpt-3.5-turbo","name":"GPT-3.5 Turbo"}]','gpt-4o-mini',1);
INSERT INTO llm_providers VALUES('openrouter','OpenRouter','https://openrouter.ai/api/v1/chat/completions','[{"id":"anthropic/claude-3.5-sonnet","name":"Claude 3.5 Sonnet"},{"id":"google/gemini-pro-1.5","name":"Gemini Pro 1.5"},{"id":"meta-llama/llama-3.1-70b-instruct","name":"Llama 3.1 70B"}]','anthropic/claude-3.5-sonnet',1);
INSERT INTO llm_providers VALUES('data-gate-provider','Data Gate Provider','https://example.invalid/v1/audio/transcriptions','[{"id":"dg-model","name":"DG Model"}]','dg-model',0);
COMMIT;
