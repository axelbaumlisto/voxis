PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE llm_prompts (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                prompt TEXT NOT NULL,
                created_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
                updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now'))
            );
INSERT INTO llm_prompts VALUES('fix_grammar','Fix grammar','Fix grammar and punctuation in transcribed speech. Return ONLY the corrected text, no commentary.',1700000000,1700000000);
INSERT INTO llm_prompts VALUES('email_tone','Email tone','Rewrite the transcribed speech as a polite professional email body. Preserve the user''s intent. Return ONLY the rewritten text.',1700000000,1700000000);
INSERT INTO llm_prompts VALUES('bullet_list','Bullet list','Turn the transcribed speech into a concise bullet list (one ''- '' per point). Preserve the order. Return ONLY the list.',1700000000,1700000000);
INSERT INTO llm_prompts VALUES('summarize','Summarize','Summarize the transcribed speech in 1–3 sentences. Return ONLY the summary.',1700000000,1700000000);
INSERT INTO llm_prompts VALUES('data_gate_prompt','Data Gate Prompt','Fixture prompt body',1700000000,1700000000);
CREATE TABLE llm_prompts_state (
                key TEXT PRIMARY KEY,
                value TEXT
            );
INSERT INTO llm_prompts_state VALUES('active_id','data_gate_prompt');
COMMIT;
