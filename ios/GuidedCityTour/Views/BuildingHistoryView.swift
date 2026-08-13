import SwiftUI
import AVFoundation

struct BuildingHistoryView: View {
    @Environment(SettingsStore.self) private var settings
    let building: GameBuilding
    let nearby: [GameBuilding]

    @State private var result: TourResult?
    @State private var isLoading = false
    @State private var errorText: String?
    @Environment(\.dismiss) private var dismiss

    private let synthesizer = AVSpeechSynthesizer()

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
                    Button("Close") { dismiss() }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button("Listen") { speak() }
                        .disabled(result?.speakText.isEmpty != false)
                }
            }
            .task { await load() }
            .onDisappear { synthesizer.stopSpeaking(at: .immediate) }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(building.displayName)
                .font(.title2.weight(.bold))
            Text(building.entityType.displayLabel + " · " + building.typeLabel)
                .font(.subheadline)
                .foregroundStyle(QuestTheme.accent)
            Text("A sketch of the place on the map. History still uses the grounded research pipeline — verified claims only.")
                .font(.caption)
                .foregroundStyle(QuestTheme.muted)
        }
    }

    @ViewBuilder
    private func resultBody(_ result: TourResult) -> some View {
        if result.cached {
            Text("Cached tour")
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

        let text = settings.kidsMode && !result.narration.kids.isEmpty
            ? result.narration.kids
            : result.narration.adult
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

    private func load() async {
        guard settings.hasApiKey else {
            errorText = "Add an OpenAI API key in Settings to research this building. Identity still comes from OpenStreetMap."
            return
        }
        isLoading = true
        errorText = nil
        defer { isLoading = false }
        let pipeline = TourPipeline(
            apiKey: settings.apiKey,
            model: settings.model,
            kidsMode: settings.kidsMode
        )
        let tour = await pipeline.run(building: building, nearby: nearby)
        result = tour
        if tour.status == .error {
            errorText = tour.message
        }
    }

    private func speak() {
        synthesizer.stopSpeaking(at: .immediate)
        guard let text = result?.speakText, !text.isEmpty else { return }
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = AVSpeechSynthesisVoice(language: "en-US")
        utterance.rate = 0.45
        utterance.pitchMultiplier = 0.95
        synthesizer.speak(utterance)
    }
}
