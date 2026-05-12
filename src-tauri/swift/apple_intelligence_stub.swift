import Foundation

/// Stub implementation when the build SDK lacks FoundationModels.
/// Compiled by build.rs when the framework is absent (older Xcode / SDK).

@_cdecl("is_apple_intelligence_available")
public func isAppleIntelligenceAvailable() -> Int32 { 0 }

@_cdecl("process_text_with_system_prompt_apple")
public func processTextWithSystemPrompt(
    _ systemPrompt: UnsafePointer<CChar>,
    _ userContent: UnsafePointer<CChar>,
    maxTokens: Int32
) -> UnsafeMutablePointer<AppleLLMResponse> {
    let ptr = UnsafeMutablePointer<AppleLLMResponse>.allocate(capacity: 1)
    ptr.initialize(to: AppleLLMResponse(response: nil, success: 0, error_message: nil))
    ptr.pointee.error_message = strdup(
        "Apple Intelligence is not available in this build (SDK requirement not met)."
    )
    return ptr
}

@_cdecl("free_apple_llm_response")
public func freeAppleLLMResponse(_ response: UnsafeMutablePointer<AppleLLMResponse>?) {
    guard let response else { return }
    if let r = response.pointee.response   { free(UnsafeMutablePointer(mutating: r)) }
    if let e = response.pointee.error_message { free(UnsafeMutablePointer(mutating: e)) }
    response.deallocate()
}
