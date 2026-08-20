import Foundation

enum LLMProvider: String, CaseIterable, Identifiable, Sendable {
    case openai
    case local

    var id: String { rawValue }

    var displayName: String {
        switch self {
        case .openai: return "OpenAI (cloud)"
        case .local: return "Local (LM Studio / Bionic)"
        }
    }
}

enum LLMDefaults {
    /// LM Studio Developer server default (OpenAI-compatible).
    static let localBaseURL = "http://127.0.0.1:1234/v1"
    /// Placeholder — LM Studio often accepts any bearer token.
    static let localAPIKey = "lm-studio"
    static let localModelHint = "gemma-4"
}
