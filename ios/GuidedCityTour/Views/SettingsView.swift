import SwiftUI

struct SettingsView: View {
    @Environment(SettingsStore.self) private var settings
    @Environment(\.dismiss) private var dismiss
    @State private var keyDraft = ""

    var body: some View {
        @Bindable var settings = settings
        NavigationStack {
            Form {
                Section("AI provider") {
                    Picker("Provider", selection: $settings.provider) {
                        ForEach(LLMProvider.allCases) { provider in
                            Text(provider.displayName).tag(provider)
                        }
                    }
                    Text(settings.usesLocalLLM
                         ? "Uses Gemma (or another model) via LM Studio’s local OpenAI-compatible server. No OpenAI credits."
                         : "Uses OpenAI cloud for discovery, research, and optional Listen voice.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                if settings.usesLocalLLM {
                    Section("Local LM Studio / Bionic") {
                        TextField("Base URL", text: $settings.localBaseURL)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .keyboardType(.URL)
                        TextField("Model id", text: $settings.localModel)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        Text("In LM Studio: Developer → Start Server (default http://127.0.0.1:1234). Copy the exact model id shown there into Model id. Simulator can use 127.0.0.1; a physical iPhone needs your Mac’s LAN IP and “Serve on Local Network”.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                } else {
                    Section("OpenAI") {
                        SecureField("API key", text: $keyDraft)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        Picker("Story model", selection: $settings.model) {
                            Text("Quality (gpt-4o)").tag(SettingsStore.qualityModel)
                            Text("Economy (gpt-4o-mini)").tag(SettingsStore.economyModel)
                        }
                        Button("Save key") {
                            settings.apiKey = keyDraft.trimmingCharacters(in: .whitespacesAndNewlines)
                        }
                        if settings.hasApiKey {
                            Button("Clear key", role: .destructive) {
                                keyDraft = ""
                                settings.apiKey = ""
                            }
                        }
                        Text("The key stays in the Keychain on this device and is sent only to OpenAI.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }

                Section("Guide options") {
                    if !settings.usesLocalLLM {
                        Picker("Listen voice", selection: $settings.ttsVoice) {
                            Text("Nova (calm guide)").tag("nova")
                            Text("Shimmer (softer)").tag("shimmer")
                            Text("Coral (warm)").tag("coral")
                        }
                    }
                    Toggle("Kids mode", isOn: $settings.kidsMode)
                    if settings.usesLocalLLM {
                        Text("Listen uses on-device speech while Local provider is selected.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }

                Section("About") {
                    LabeledContent("App", value: AppIdentity.displayName)
                    LabeledContent("Pipeline", value: AppIdentity.version)
                    Label("Shared story cache enabled", systemImage: "icloud.fill")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    Text("Stories and map pins are saved to a shared database so repeat visits skip AI calls for the same place.")
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
