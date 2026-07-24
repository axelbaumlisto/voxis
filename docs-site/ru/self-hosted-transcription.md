---
title: Self-Hosted транскрипция
layout: default
---

# Self-Hosted и альтернативные провайдеры транскрипции

Клиент транскрипции Voxis использует стандартный, совместимый с OpenAI
протокол `/audio/transcriptions`: multipart-форма (`file`, `model`,
`response_format=verbose_json`, опционально `language`/`translate`),
отправляемая с заголовком `Authorization: Bearer <api_key>`, и ожидает в
ответ JSON как минимум с полем `text`. Любой сервер, реализующий этот же
контракт — другой облачный провайдер или полностью self-hosted
Whisper-совместимый сервер — подключается указанием `api_url_override` в
конфигурации приложения. Изменения кода не требуются, и приложение
намеренно не поставляет отдельный SDK-адаптер под каждого провайдера или
платформенный (native) движок транскрипции.

`api_url_override` не отображается в UI Настроек — это поле конфигурации,
используемое через тесты или кастомную сборку. Полное описание, проверенные
endpoint'ы и рабочие примеры — в документе на английском языке, на который
ссылается этот раздел ниже.

## Быстрый старт: self-host через Docker

Этот репозиторий содержит
[`docker-compose.selfhost.yml`](https://github.com/axelbaumlisto/voxis/blob/main/docker-compose.selfhost.yml)
в корне проекта — тонкую обёртку над образом
[`speaches`](https://github.com/speaches-ai/speaches) (совместимый с
OpenAI, на основе `faster-whisper`), с разумными локальными настройками по
умолчанию (привязка только к `127.0.0.1`, хранение загруженных моделей в
именованном volume).

```bash
docker compose -f docker-compose.selfhost.yml up -d
docker compose -f docker-compose.selfhost.yml exec speaches \
  curl -sX POST "http://localhost:8000/v1/models/Systran/faster-whisper-large-v3"
```

Затем в Настройках Voxis укажите:

- **API URL override**: `http://localhost:8000/v1/audio/transcriptions`
- **Model**: `Systran/faster-whisper-large-v3` (или другая загруженная модель)
- **API key**: любое непустое значение-плейсхолдер — сервер его не
  проверяет, но клиент Voxis всегда отправляет заголовок
  `Authorization: Bearer <key>`

Вариант `--profile gpu` включён для ускорения на NVIDIA GPU.

## Вариант для macOS: Apple SpeechAnalyzer

На Mac с Apple Silicon и macOS 26+ проекты сообщества (например,
[`ohr`](https://github.com/Arthur-Ficial/ohr)) оборачивают встроенный
on-device `SpeechAnalyzer`/`SpeechTranscriber` API в OpenAI-совместимый
HTTP-сервер, который подключается через `api_url_override` так же, как
любой другой self-hosted вариант. Он быстрый и лёгкий (проверенный рост
RSS ~10MB в вызывающем процессе, инференс выполняется вне процесса на
Neural Engine) и даёт хорошую точность для английского языка, **но
поддерживает всего 30 локалей и не поддерживает русский язык** (как и
большинство языков за пределами en/es/fr/de/it/ja/ko/pt/yue/zh) — для
неподдерживаемых языков используйте вариант Docker/`speaches` выше с
моделью `large-v3`.

## Полные детали

Смотрите **[docs/SELF_HOSTED_TRANSCRIPTION.md](https://github.com/axelbaumlisto/voxis/blob/main/docs/SELF_HOSTED_TRANSCRIPTION.md)**
в репозитории (на английском языке) для:

- Точной формы запроса/ответа протокола, который ожидает Voxis.
- Таблицы известных облачных endpoint'ов (Groq по умолчанию, OpenAI, Azure OpenAI).
- Других protocol-совместимых self-hosted вариантов (обёртки whisper.cpp, LocalAI).
- Проверенных результатов по памяти, точности и поддержке языков — как для
  `speaches`, так и для варианта macOS `SpeechAnalyzer`, измеренных на
  реальном коде клиента транскрипции этого проекта.
- Заметок о серверах без аутентификации (поле API-ключа всё равно нельзя
  оставить пустым).

См. также [Настройки](settings.md) и [Установка](installation.md#api-ключи).

---
<div style="text-align: right;">
  <a href="../self-hosted-transcription.html" style="text-decoration: none; font-weight: bold;">🇬🇧 Read in English</a>
</div>
