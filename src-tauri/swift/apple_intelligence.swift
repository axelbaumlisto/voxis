import Dispatch
import Foundation
import FoundationModels

// MARK: - Helpers

private func duplicateCString(_ text: String) -> UnsafeMutablePointer<CChar>? {
    return text.withCString { strdup($0) }
}

private func truncatedText(_ text: String, limit: Int) -> String {
    guard limit > 0 else { return text }
    let words = text.split(
        maxSplits: .max,
        omittingEmptySubsequences: true,
        whereSeparator: { $0.isWhitespace || $0.isNewline }
    )
    if words.count <= limit { return text }
    return words.prefix(limit).joined(separator: " ")
}

// MARK: - Exported C functions

@_cdecl("is_apple_intelligence_available")
public func isAppleIntelligenceAvailable() -> Int32 {
    guard #available(macOS 26.0, *) else { return 0 }
    let model = SystemLanguageModel.default
    switch model.availability {
    case .available: return 1
    case .unavailable: return 0
    }
}

@_cdecl("process_text_with_system_prompt_apple")
public func processTextWithSystemPrompt(
    _ systemPrompt: UnsafePointer<CChar>,
    _ userContent: UnsafePointer<CChar>,
    maxTokens: Int32
) -> UnsafeMutablePointer<AppleLLMResponse> {
    let swiftSystem = String(cString: systemPrompt)
    let swiftUser   = String(cString: userContent)

    let ptr = UnsafeMutablePointer<AppleLLMResponse>.allocate(capacity: 1)
    ptr.initialize(to: AppleLLMResponse(response: nil, success: 0, error_message: nil))

    guard #available(macOS 26.0, *) else {
        ptr.pointee.error_message = duplicateCString(
            "Apple Intelligence requires macOS 26 or newer."
        )
        return ptr
    }

    let model = SystemLanguageModel.default
    guard model.availability == .available else {
        ptr.pointee.error_message = duplicateCString(
            "Apple Intelligence is not currently available on this device."
        )
        return ptr
    }

    // Bridge async Swift → synchronous C call via semaphore.
    let sem = DispatchSemaphore(value: 0)

    final class ResultBox: @unchecked Sendable {
        var response: String?
        var error: String?
    }
    let box = ResultBox()

    Task.detached(priority: .userInitiated) {
        defer { sem.signal() }
        do {
            let session = LanguageModelSession(model: model, instructions: swiftSystem)
            let generation = try await session.respond(to: swiftUser)
            var output = generation.content

            let tokenLimit = max(0, Int(maxTokens))
            if tokenLimit > 0 { output = truncatedText(output, limit: tokenLimit) }
            box.response = output
        } catch {
            box.error = error.localizedDescription
        }
    }

    sem.wait()

    if let text = box.response {
        ptr.pointee.response = duplicateCString(text)
        ptr.pointee.success = 1
    } else {
        ptr.pointee.error_message = duplicateCString(box.error ?? "Unknown error")
    }
    return ptr
}

@_cdecl("free_apple_llm_response")
public func freeAppleLLMResponse(_ response: UnsafeMutablePointer<AppleLLMResponse>?) {
    guard let response else { return }
    if let r = response.pointee.response   { free(UnsafeMutablePointer(mutating: r)) }
    if let e = response.pointee.error_message { free(UnsafeMutablePointer(mutating: e)) }
    response.deallocate()
}
