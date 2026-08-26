import SwiftUI

struct OnboardingView: View {
    @Environment(SettingsStore.self) private var settings
    @Environment(LocationService.self) private var location
    @State private var step = 0
    @State private var keyDraft = ""

    var body: some View {
        VStack(spacing: 0) {
            header
            TabView(selection: $step) {
                welcomePage.tag(0)
                locationPage.tag(1)
                keyPage.tag(2)
            }
            .tabViewStyle(.page(indexDisplayMode: .always))

            Button(action: advance) {
                Text(step == 2 ? "Start scanning" : "Continue")
                    .font(.headline)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 14)
            }
            .buttonStyle(.borderedProminent)
            .padding(.horizontal, 24)
            .padding(.bottom, 28)
        }
        .background(QuestTheme.bgDeep.ignoresSafeArea())
        .onAppear { keyDraft = settings.apiKey }
    }

    private var header: some View {
        VStack(spacing: 6) {
            Text(AppIdentity.displayName)
                .font(.largeTitle.weight(.bold))
                .foregroundStyle(QuestTheme.text)
            Text(AppIdentity.subtitle)
                .font(.subheadline)
                .foregroundStyle(QuestTheme.accent)
        }
        .padding(.top, 36)
        .padding(.bottom, 8)
    }

    private var welcomePage: some View {
        page(
            title: "Photograph one landmark",
            bodyText: "Take a photo of a building, church, or statue. City Quest uses your location and the image to identify that place and tell its history — one place at a time."
        )
    }

    private var locationPage: some View {
        VStack(spacing: 18) {
            page(
                title: "Use your location",
                bodyText: "Your GPS and address help confirm the place in the photo is the local building — not a lookalike in another city."
            )
            Button("Allow location") {
                location.requestWhenInUse()
            }
            .buttonStyle(.bordered)
            if let err = location.lastError {
                Text(err).font(.footnote).foregroundStyle(QuestTheme.error).padding(.horizontal, 28)
            }
        }
    }

    private var keyPage: some View {
        VStack(alignment: .leading, spacing: 14) {
            page(
                title: "AI provider (optional now)",
                bodyText: "OpenAI (vision) works best for photo ID. You can also try Local LM Studio / Bionic with a vision-capable Gemma model in Settings."
            )
            SecureField("sk-...", text: $keyDraft)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(12)
                .background(QuestTheme.bgPanel)
                .clipShape(RoundedRectangle(cornerRadius: 10))
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(QuestTheme.border, lineWidth: 1)
                )
                .padding(.horizontal, 28)
            Picker("Model", selection: Binding(
                get: { settings.model },
                set: { settings.model = $0 }
            )) {
                Text("Quality (gpt-4o)").tag(SettingsStore.qualityModel)
                Text("Economy (gpt-4o-mini)").tag(SettingsStore.economyModel)
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 28)
        }
    }

    private func page(title: String, bodyText: String) -> some View {
        VStack(spacing: 14) {
            Spacer()
            Text(title)
                .font(.title2.weight(.semibold))
                .foregroundStyle(QuestTheme.text)
                .multilineTextAlignment(.center)
            Text(bodyText)
                .font(.body)
                .foregroundStyle(QuestTheme.muted)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 28)
            Spacer()
        }
    }

    private func advance() {
        if step < 2 {
            step += 1
            return
        }
        settings.apiKey = keyDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        settings.hasCompletedOnboarding = true
    }
}
