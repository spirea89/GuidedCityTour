import Foundation
import Observation
import Security

@MainActor
@Observable
final class SettingsStore {
    var provider: LLMProvider {
        didSet { UserDefaults.standard.set(provider.rawValue, forKey: Self.providerKey) }
    }

    var apiKey: String {
        didSet { KeychainStore.set(apiKey, account: Self.keyAccount) }
    }

    var model: String {
        didSet { UserDefaults.standard.set(model, forKey: Self.modelKey) }
    }

    var localBaseURL: String {
        didSet { UserDefaults.standard.set(localBaseURL, forKey: Self.localURLKey) }
    }

    var localModel: String {
        didSet { UserDefaults.standard.set(localModel, forKey: Self.localModelKey) }
    }

    var kidsMode: Bool {
        didSet { UserDefaults.standard.set(kidsMode, forKey: Self.kidsKey) }
    }

    var ttsVoice: String {
        didSet { UserDefaults.standard.set(ttsVoice, forKey: Self.ttsVoiceKey) }
    }

    var hasCompletedOnboarding: Bool {
        didSet { UserDefaults.standard.set(hasCompletedOnboarding, forKey: Self.onboardKey) }
    }

    var hasApiKey: Bool { !apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    /// Ready to discover places / generate stories for the selected provider.
    var hasConfiguredLLM: Bool {
        switch provider {
        case .openai:
            return hasApiKey
        case .local:
            return !normalizedLocalBaseURL.isEmpty && !localModel.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
    }

    var usesLocalLLM: Bool { provider == .local }

    var activeModel: String {
        switch provider {
        case .openai: return model
        case .local: return localModel.trimmingCharacters(in: .whitespacesAndNewlines)
        }
    }

    var normalizedLocalBaseURL: String {
        var url = localBaseURL.trimmingCharacters(in: .whitespacesAndNewlines)
        while url.hasSuffix("/") { url.removeLast() }
        if url.hasSuffix("/v1") { return url }
        if url.hasSuffix("/v1/") { return String(url.dropLast()) }
        return url.isEmpty ? "" : url + "/v1"
    }

    func makeClient() -> OpenAIClient {
        switch provider {
        case .openai:
            return OpenAIClient(apiKey: apiKey, model: model)
        case .local:
            return OpenAIClient(
                apiKey: LLMDefaults.localAPIKey,
                model: activeModel,
                baseURL: normalizedLocalBaseURL,
                timeout: 180
            )
        }
    }

    static let qualityModel = "gpt-4o"
    static let economyModel = "gpt-4o-mini"
    static let ttsVoices = ["nova", "shimmer", "coral"]
    static let defaultTtsVoice = "nova"

    private static let keyAccount = "openai-api-key"
    private static let providerKey = "gct_ios_provider"
    private static let modelKey = "gct_ios_model"
    private static let localURLKey = "gct_ios_local_url"
    private static let localModelKey = "gct_ios_local_model"
    private static let kidsKey = "gct_ios_kids"
    private static let ttsVoiceKey = "gct_ios_tts_voice"
    private static let onboardKey = "gct_ios_onboarded"

    init() {
        let rawProvider = UserDefaults.standard.string(forKey: Self.providerKey) ?? LLMProvider.openai.rawValue
        provider = LLMProvider(rawValue: rawProvider) ?? .openai
        apiKey = KeychainStore.get(account: Self.keyAccount) ?? ""
        let storedModel = UserDefaults.standard.string(forKey: Self.modelKey) ?? Self.qualityModel
        model = storedModel == Self.economyModel ? Self.economyModel : Self.qualityModel
        localBaseURL = UserDefaults.standard.string(forKey: Self.localURLKey) ?? LLMDefaults.localBaseURL
        localModel = UserDefaults.standard.string(forKey: Self.localModelKey) ?? LLMDefaults.localModelHint
        kidsMode = UserDefaults.standard.bool(forKey: Self.kidsKey)
        let storedVoice = (UserDefaults.standard.string(forKey: Self.ttsVoiceKey) ?? Self.defaultTtsVoice).lowercased()
        ttsVoice = Self.ttsVoices.contains(storedVoice) ? storedVoice : Self.defaultTtsVoice
        hasCompletedOnboarding = UserDefaults.standard.bool(forKey: Self.onboardKey)
    }
}

enum KeychainStore {
    private static let service = "com.guidedcitytour.ios"

    static func get(account: String) -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        guard status == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func set(_ value: String, account: String) {
        let data = value.data(using: .utf8) ?? Data()
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        SecItemDelete(base as CFDictionary)
        guard !value.isEmpty else { return }
        var add = base
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
    }
}
