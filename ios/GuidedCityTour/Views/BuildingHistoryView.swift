import SwiftUI

struct BuildingHistoryView: View {
    @Environment(SettingsStore.self) private var settings
    let building: GameBuilding
    let nearby: [GameBuilding]

    @State private var result: TourResult?
    @State private var isLoading = false
    @State private var errorText: String?
    @State private var narrator = MuseumGuideNarrator()
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    header
                    if isLoading {
                        ProgressView("Identifying place and researching with source checks…")
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 24)
                    }
                    if let errorText {
                        Text(errorText)
                            .foregroundStyle(QuestTheme.error)
                            .font(.footnote)
                    }
                    if let result {
                        listenControls
                        resultBody(result)
                    }
                }
                .padding(18)
            }
            .background(QuestTheme.bgDeep)
            .navigationTitle("Building lore")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") {
                        narrator.stop()
                        dismiss()
                    }
                }
            }
            .task { await load() }
            .onDisappear { narrator.stop() }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(building.displayName)
                .font(.title2.weight(.bold))
            Text(building.entityType.displayLabel + " · " + building.typeLabel)
                .font(.subheadline)
                .foregroundStyle(QuestTheme.accent)
            Text("History uses the grounded research pipeline — verified claims only.")
                .font(.caption)
                .foregroundStyle(QuestTheme.muted)
        }
    }

    private var listenControls: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 10) {
                Button {
                    speakStory()
                } label: {
                    Label(
                        narrator.isPreparing ? "Preparing…" : (narrator.isSpeaking ? "Playing…" : "Listen"),
                        systemImage: narrator.isPreparing
                            ? "ellipsis.circle"
                            : (narrator.isSpeaking ? "speaker.wave.2.fill" : "play.fill")
                    )
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .disabled(!hasSpeakableText || narrator.isSpeaking || narrator.isPreparing)

                Button {
                    narrator.togglePause()
                } label: {
                    Text(narrator.isPaused ? "Resume" : "Pause")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
                .disabled(!narrator.canPause)

                Button {
                    narrator.stop()
                } label: {
                    Text("Stop")
                }
                .buttonStyle(.bordered)
                .disabled(narrator.state == .idle)
            }

            Text(narrator.statusMessage)
                .font(.caption)
                .foregroundStyle((narrator.isSpeaking || narrator.isPreparing) ? QuestTheme.accent : QuestTheme.muted)

            Text(settings.usesLocalLLM
                 ? "Listen uses on-device speech with Local AI. Stories come from your Mac’s Gemma / LM Studio model."
                 : (settings.hasApiKey
                    ? "Uses OpenAI voice (\(settings.ttsVoice)) for a natural museum guide. Falls back to on-device speech if needed."
                    : "Add an OpenAI API key in Settings for a natural human-like museum voice."))
                .font(.caption2)
                .foregroundStyle(QuestTheme.muted)
        }
        .padding(12)
        .background(QuestTheme.bgPanel)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(QuestTheme.border, lineWidth: 1)
        )
        .onAppear {
            narrator.configure(
                apiKey: settings.usesLocalLLM ? "" : settings.apiKey,
                voice: settings.ttsVoice
            )
        }
    }

    @ViewBuilder
    private func resultBody(_ result: TourResult) -> some View {
        if result.cached {
            Text("Cached tour (shared or on device)")
                .font(.caption2)
                .foregroundStyle(QuestTheme.muted)
        }

        if result.status == .webSearchUnavailable {
            Text(result.message.isEmpty
                 ? "Web research was unavailable. Historical facts were not invented."
                 : result.message)
                .font(.footnote)
                .foregroundStyle(QuestTheme.error)
        }

        let text = displayText(for: result)
        if !text.isEmpty {
            Text(text)
                .font(.body)
                .lineSpacing(4)
        }

        let order = ["history", "architecture", "famous_people", "interesting_facts", "today"]
        let titles = [
            "history": "History",
            "architecture": "Architecture",
            "famous_people": "Personalities",
            "interesting_facts": "Interesting facts",
            "today": "Today"
        ]
        ForEach(order, id: \.self) { key in
            if let section = result.narration.sections[key], !section.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text(titles[key] ?? key)
                        .font(.caption.weight(.bold))
                        .foregroundStyle(QuestTheme.accent)
                        .textCase(.uppercase)
                    Text(section)
                        .font(.callout)
                        .lineSpacing(3)
                }
            }
        }

        if !result.claims.verified.isEmpty {
            Text("\(result.claims.verified.count) verified claims")
                .font(.caption)
                .foregroundStyle(QuestTheme.muted)
        }

        if !result.citations.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                Text("Sources")
                    .font(.caption.weight(.bold))
                    .foregroundStyle(QuestTheme.muted)
                    .textCase(.uppercase)
                ForEach(result.citations) { cite in
                    if let url = URL(string: cite.url), !cite.url.isEmpty {
                        Link(cite.title.isEmpty ? cite.url : cite.title, destination: url)
                            .font(.footnote)
                    } else {
                        Text(cite.title).font(.footnote)
                    }
                }
            }
        }
    }

    private var hasSpeakableText: Bool {
        guard let result else { return false }
        return !speakableText(for: result).isEmpty
    }

    private func displayText(for result: TourResult) -> String {
        if settings.kidsMode, !result.narration.kids.isEmpty {
            return result.narration.kids
        }
        if !result.narration.adult.isEmpty {
            return result.narration.adult
        }
        return speakableText(for: result)
    }

    private func speakableText(for result: TourResult) -> String {
        if settings.kidsMode, !result.narration.kids.isEmpty {
            return result.narration.kids
        }
        if !result.narration.adult.isEmpty {
            return result.narration.adult
        }
        let ordered = ["history", "architecture", "famous_people", "interesting_facts", "today"]
        return ordered
            .compactMap { result.narration.sections[$0] }
            .filter { !$0.isEmpty }
            .joined(separator: "\n\n")
    }

    private func load() async {
        guard settings.hasConfiguredLLM else {
            errorText = settings.usesLocalLLM
                ? "Configure Local LM Studio / Bionic in Settings."
                : "Add an OpenAI API key in Settings to research this building."
            return
        }
        isLoading = true
        errorText = nil
        defer { isLoading = false }
        let pipeline = TourPipeline(
            client: settings.makeClient(),
            kidsMode: settings.kidsMode,
            usesLocalLLM: settings.usesLocalLLM
        )
        let tour = await pipeline.run(building: building, nearby: nearby)
        result = tour
        if tour.status == .error {
            errorText = tour.message
        }
    }

    private func speakStory() {
        guard let result else {
            narrator.statusMessage = "Wait for the story to finish loading."
            return
        }
        let text = speakableText(for: result)
        guard !text.isEmpty else {
            narrator.statusMessage = "No narration text is available for this place yet."
            return
        }
        narrator.configure(
            apiKey: settings.usesLocalLLM ? "" : settings.apiKey,
            voice: settings.ttsVoice
        )
        narrator.speak(text)
    }
}
