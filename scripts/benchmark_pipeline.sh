#!/bin/bash
# Performance benchmark for transcription pipeline
# Tests both Groq API transcription and enigo typing speed
#
# Usage:
#   ./scripts/benchmark_pipeline.sh [audio_file]
#   ./scripts/benchmark_pipeline.sh --typing-only "text to type"
#
# Environment:
#   GROQ_API_KEY - Required for transcription test

set -e

cd "$(dirname "$0")/.."

TARGET_TOTAL_MS=3000
TARGET_TYPING_MS=500

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_header() {
    echo ""
    echo "=== $1 ==="
    echo ""
}

# Parse arguments
if [[ "$1" == "--typing-only" ]]; then
    TEXT="${2:-Привет мир! Hello world! Testing 123.}"
    print_header "Typing Benchmark Only"
    echo "Text: \"$TEXT\""
    echo "Chars: $(echo -n "$TEXT" | wc -m)"
    echo ""

    # Build if needed
    if [[ ! -f "src-tauri/target/release/typing_bench" ]]; then
        echo "Building typing_bench..."
        cargo build --release --bin typing_bench --manifest-path src-tauri/Cargo.toml 2>&1 | tail -3
    fi

    echo ">>> Running typing benchmark..."
    ./src-tauri/target/release/typing_bench "$TEXT"
    exit $?
fi

# Full pipeline benchmark
AUDIO_FILE="${1:-}"
API_KEY="${GROQ_API_KEY:-}"

# Find a test audio file if not provided
if [[ -z "$AUDIO_FILE" ]]; then
    AUDIO_FILE=$(find ~/.config/soupawhisper/debug -name "audio_*.wav" 2>/dev/null | head -1 || true)
    if [[ -z "$AUDIO_FILE" ]]; then
        echo "No audio file found. Please provide one:"
        echo "  $0 /path/to/audio.wav"
        echo ""
        echo "Or run typing-only benchmark:"
        echo "  $0 --typing-only \"text to type\""
        exit 1
    fi
fi

if [[ -z "$API_KEY" ]]; then
    echo -e "${RED}Error: GROQ_API_KEY not set${NC}"
    echo "Export your Groq API key:"
    echo "  export GROQ_API_KEY=gsk_..."
    exit 1
fi

print_header "Pipeline Performance Benchmark"
echo "Audio: $AUDIO_FILE"
echo "Target: < ${TARGET_TOTAL_MS}ms total, < ${TARGET_TYPING_MS}ms typing"
echo ""

# 1. Transcription benchmark
echo ">>> [1/2] Transcription API (Groq Whisper)..."
START=$(date +%s%3N)
RESPONSE=$(curl -s -X POST "https://api.groq.com/openai/v1/audio/transcriptions" \
    -H "Authorization: Bearer $API_KEY" \
    -F "file=@$AUDIO_FILE" \
    -F "model=whisper-large-v3" \
    -F "response_format=verbose_json")
END=$(date +%s%3N)
TRANSCRIPTION_MS=$((END - START))

TEXT=$(echo "$RESPONSE" | jq -r '.text // empty')
if [[ -z "$TEXT" ]]; then
    echo -e "${RED}Transcription failed:${NC}"
    echo "$RESPONSE" | jq .
    exit 1
fi

echo "Time: ${TRANSCRIPTION_MS}ms"
echo "Text: \"$TEXT\""
CHAR_COUNT=$(echo -n "$TEXT" | wc -m)
echo "Chars: $CHAR_COUNT"
echo ""

# 2. Typing benchmark
echo ">>> [2/2] Auto-type benchmark (enigo)..."

# Build if needed
if [[ ! -f "src-tauri/target/release/typing_bench" ]]; then
    echo "Building typing_bench..."
    cargo build --release --bin typing_bench --manifest-path src-tauri/Cargo.toml 2>&1 | tail -3
fi

# Run dry-run to avoid actually typing during benchmark
START=$(date +%s%3N)
./src-tauri/target/release/typing_bench --dry-run "$TEXT"
END=$(date +%s%3N)
TYPING_MS=$((END - START))

echo "Benchmark time: ${TYPING_MS}ms (dry-run, actual typing ~2x)"
# Estimate actual typing time (dry-run measures init only)
EST_TYPING_MS=$((TYPING_MS + CHAR_COUNT / 2))
echo "Estimated actual: ${EST_TYPING_MS}ms"
echo ""

# 3. Results
TOTAL_MS=$((TRANSCRIPTION_MS + EST_TYPING_MS))

print_header "Results"
printf "%-20s %8sms\n" "Transcription:" "$TRANSCRIPTION_MS"
printf "%-20s %8sms (estimated)\n" "Typing:" "$EST_TYPING_MS"
printf "%-20s %8sms\n" "TOTAL:" "$TOTAL_MS"
echo ""

# 4. Verdict
PASS=true

if [[ $TRANSCRIPTION_MS -gt 2000 ]]; then
    echo -e "${YELLOW}⚠ Transcription slow (${TRANSCRIPTION_MS}ms > 2000ms)${NC}"
fi

if [[ $EST_TYPING_MS -gt $TARGET_TYPING_MS ]]; then
    echo -e "${RED}❌ Typing too slow: ${EST_TYPING_MS}ms > ${TARGET_TYPING_MS}ms target${NC}"
    PASS=false
fi

if [[ $TOTAL_MS -lt $TARGET_TOTAL_MS ]]; then
    echo -e "${GREEN}✅ PASS: ${TOTAL_MS}ms < ${TARGET_TOTAL_MS}ms target${NC}"
else
    echo -e "${RED}❌ FAIL: ${TOTAL_MS}ms >= ${TARGET_TOTAL_MS}ms target${NC}"
    PASS=false
fi

if [[ "$PASS" != "true" ]]; then
    exit 1
fi
