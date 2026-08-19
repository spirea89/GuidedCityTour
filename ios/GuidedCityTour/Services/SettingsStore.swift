import Foundation
import Observation
import Security

@MainActor
@Observable
final class SettingsStore {
    var apiKey: String {
        didSet { KeychainStore.set(apiKey, account: Self.keyAccount) }
    }

    var model: String {
        didSet { UserDefaults.standard.set(model, forKey: Self.modelKey) }
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

    var supabaseAnonKey: String {
        didSet { KeychainStore.set(supabaseAnonKey, account: Self.supabaseKeyAccount) }
    }

    var hasApiKey: Bool { !apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }
    var hasSupabaseKey: Bool { !supabaseAnonKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    static let qualityModel = "gpt-4o"
    static let economyModel = "gpt-4o-mini"
    static let ttsVoices = ["nova", "shimmer", "coral"]
    static let defaultTtsVoice = "nova"

    private static let keyAccount = "openai-api-key"
    private static let supabaseKeyAccount = "supabase-anon-key"
    private static let modelKey = "gct_ios_model"
    private static let kidsKey = "gct_ios_kids"
    private static let ttsVoiceKey = "gct_ios_tts_voice"
    private static let onboardKey = "gct_ios_onboarded"

    func syncSupabaseClient() {
        SupabaseCacheService.anonKey = supabaseAnonKey
    }

    init() {
        apiKey = KeychainStore.get(account: Self.keyAccount) ?? ""
        supabaseAnonKey = KeychainStore.get(account: Self.supabaseKeyAccount) ?? ""
        SupabaseCacheService.anonKey = supabaseAnonKey
        let storedModel = UserDefaults.standard.string(forKey: Self.modelKey) ?? Self.qualityModel
        model = storedModel == Self.economyModel ? Self.economyModel : Self.qualityModel
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
