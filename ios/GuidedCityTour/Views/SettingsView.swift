import SwiftUI

struct SettingsView: View {
    @Environment(SettingsStore.self) private var settings
    @Environment(\.dismiss) private var dismiss
    @State private var keyDraft = ""
    @State private var supabaseDraft = ""

    var body: some View {
        @Bindable var settings = settings
        NavigationStack {
            Form {
                Section("Shared story cache") {
                    SecureField("Supabase anon key", text: $supabaseDraft)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Button("Save Supabase key") {
                        settings.supabaseAnonKey = supabaseDraft.trimmingCharacters(in: .whitespacesAndNewlines)
                        settings.syncSupabaseClient()
                    }
                    if settings.hasSupabaseKey {
                        Label("Connected to shared cache", systemImage: "checkmark.circle.fill")
                            .foregroundStyle(.green)
                            .font(.footnote)
                        Button("Clear Supabase key", role: .destructive) {
                            supabaseDraft = ""
                            settings.supabaseAnonKey = ""
                            settings.syncSupabaseClient()
                        }
                    }
                    Text("Project: ifoybmzofjdgekvvrsot. Paste the anon public key from Supabase → Settings → API. Saved stories and map pins are reused for everyone — no extra OpenAI credits.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

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
                        if !supabaseDraft.isEmpty {
                            settings.supabaseAnonKey = supabaseDraft.trimmingCharacters(in: .whitespacesAndNewlines)
                            settings.syncSupabaseClient()
                        }
                        dismiss()
                    }
                }
            }
            .onAppear {
                keyDraft = settings.apiKey
                supabaseDraft = settings.supabaseAnonKey
            }
        }
    }
}
