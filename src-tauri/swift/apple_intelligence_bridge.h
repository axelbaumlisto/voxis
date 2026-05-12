#ifndef apple_intelligence_bridge_h
#define apple_intelligence_bridge_h

/// C-compatible bridge for Swift ↔ Rust FFI.
/// Compiled only on macOS aarch64 via build.rs.

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    char* response;
    int success;        /* 0 = failure, 1 = success */
    char* error_message; /* valid when success == 0 */
} AppleLLMResponse;

int is_apple_intelligence_available(void);

AppleLLMResponse* process_text_with_system_prompt_apple(
    const char* system_prompt,
    const char* user_content,
    int max_tokens
);

void free_apple_llm_response(AppleLLMResponse* response);

#ifdef __cplusplus
}
#endif

#endif /* apple_intelligence_bridge_h */
