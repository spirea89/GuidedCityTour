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
                    Picker("Listen voice", selection: $settings.ttsVoice) {
                        Text("Nova (calm guide)").tag("nova")
                        Text("Shimmer (softer)").tag("shimmer")
                        Text("Coral (warm)").tag("coral")
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
                    Text("The key stays in the Keychain on this device and is sent only to OpenAI when you find places, research history, or Listen with a natural voice.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section("About") {
                    LabeledContent("App", value: AppIdentity.displayName)
                    LabeledContent("Pipeline", value: AppIdentity.version)
                    Label("Shared story cache enabled", systemImage: "icloud.fill")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Text("Stories and map pins are saved to a shared database so repeat visits skip OpenAI for the same place.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Text("City Quest pins the most important buildings in a neighbourhood. Tap a pin for sourced history — the same grounded tour pipeline as Guided City Tour.")
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
