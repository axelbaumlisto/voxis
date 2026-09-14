PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                text TEXT NOT NULL,
                language TEXT DEFAULT '',
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            , duration REAL);
INSERT INTO history VALUES(1,'data gate known transcription one','en','2026-01-01 10:00:00',1.5);
INSERT INTO history VALUES(2,'data gate known transcription two','ru','2026-01-01 10:00:05',2.25);
DELETE FROM sqlite_sequence;
INSERT INTO sqlite_sequence VALUES('history',2);
CREATE INDEX idx_timestamp ON history(timestamp DESC);
COMMIT;
