import SwiftUI

struct SettingsView: View {
    @Environment(SettingsStore.self) private var settings
    @Environment(\.dismiss) private var dismiss
    @State private var keyDraft = ""

    var body: some View {
        @Bindable var settings = settings
        NavigationStack {
            Form {
                Section("OpenAI") {
                    SecureField("API key", text: $keyDraft)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Picker("Story model", selection: $settings.model) {
                        Text("Quality (gpt-4o)").tag(SettingsStore.qualityModel)
                        Text("Economy (gpt-4o-mini)").tag(SettingsStore.economyModel)
                    }
                    Toggle("Kids mode", isOn: $settings.kidsMode)
                    Button("Save key") {
                        settings.apiKey = keyDraft.trimmingCharacters(in: .whitespacesAndNewlines)
                    }
                    if settings.hasApiKey {
                        Button("Clear key", role: .destructive) {
                            keyDraft = ""
                            settings.apiKey = ""
                        }
                    }
                    Text("The key stays in the Keychain on this device and is sent only to OpenAI when you discover history.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section("About") {
                    LabeledContent("App", value: AppIdentity.displayName)
                    LabeledContent("Pipeline", value: AppIdentity.version)
                    Text("City Quest is the iOS game-sketch layer of Guided City Tour. Buildings are stylized OpenStreetMap footprints, not photoreal copies. History still requires sources.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }
            }
            .navigationTitle("Settings")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        if !keyDraft.isEmpty {
                            settings.apiKey = keyDraft.trimmingCharacters(in: .whitespacesAndNewlines)
                        }
                        dismiss()
                    }
                }
            }
            .onAppear { keyDraft = settings.apiKey }
        }
    }
}
