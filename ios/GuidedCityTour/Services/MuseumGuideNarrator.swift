import Foundation
import AVFoundation
import Observation

/// Natural museum-guide narration via OpenAI TTS, with on-device AVSpeech fallback.
@MainActor
@Observable
final class MuseumGuideNarrator: NSObject {
    enum State: Equatable {
        case idle
        case preparing
        case speaking
        case paused
    }

    var state: State = .idle
    var statusMessage = "Tap Listen for a natural museum-style audio guide"

    private let synthesizer = AVSpeechSynthesizer()
    private var preferredDeviceVoice: AVSpeechSynthesisVoice?
    private var audioPlayer: AVAudioPlayer?
    private var speakTask: Task<Void, Never>?
    private var playbackContinuation: CheckedContinuation<Void, Never>?
    private var openAIVoice = "nova"
    private var openAIKey = ""
    private var resolvedTtsModel: String?
    private var engine: Engine = .none

    private enum Engine {
        case none, openAI, device
    }

    private static let preferredTtsModel = "gpt-4o-mini-tts"
    private static let fallbackTtsModel = "tts-1-hd"
    private static let maxChunkChars = 3600
    private static let museumInstructions =
        "Speak as a calm museum city-guide narrator. Warm, clear English with measured pacing. Sound informative and welcoming, not theatrical or robotic."

    override init() {
        super.init()
        synthesizer.delegate = self
        preferredDeviceVoice = Self.pickMuseumVoice(from: AVSpeechSynthesisVoice.speechVoices())
    }

    var isSpeaking: Bool { state == .speaking }
    var isPaused: Bool { state == .paused }
    var isPreparing: Bool { state == .preparing }
    var canPause: Bool { state == .speaking || state == .paused }

    func configure(apiKey: String, voice: String) {
        openAIKey = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        openAIVoice = ["nova", "shimmer", "coral"].contains(voice) ? voice : "nova"
        if state == .idle {
            statusMessage = openAIKey.isEmpty
                ? "Tap Listen — add an API key for a natural OpenAI museum voice"
                : "Tap Listen for a natural museum-style audio guide"
        }
    }

    func speak(_ raw: String) {
        let text = Self.cleanForSpeech(raw)
        guard !text.isEmpty else {
            statusMessage = "Nothing to narrate yet."
            return
        }

        stop(resetMessage: false)
        configureAudioSession()

        if !openAIKey.isEmpty {
            speakWithOpenAI(text)
        } else {
            statusMessage = "No API key — using on-device voice. Add a key for natural OpenAI narration."
            speakWithDevice(text)
        }
    }

    func togglePause() {
        switch engine {
        case .openAI:
            guard let player = audioPlayer else { return }
            if player.isPlaying {
                player.pause()
                state = .paused
                statusMessage = "Paused — tap Resume to continue."
            } else if state == .paused {
                player.play()
                state = .speaking
                statusMessage = "Listening · OpenAI \(openAIVoice)"
            }
        case .device:
            if synthesizer.isSpeaking && !synthesizer.isPaused {
                synthesizer.pauseSpeaking(at: .word)
                state = .paused
                statusMessage = "Paused — tap Resume to continue."
            } else if synthesizer.isPaused {
                synthesizer.continueSpeaking()
                state = .speaking
                statusMessage = deviceVoiceHint()
            }
        case .none:
            break
        }
    }

    func stop() {
        stop(resetMessage: true)
    }

    private func stop(resetMessage: Bool) {
        speakTask?.cancel()
        speakTask = nil
        finishPlaybackWait()

        if synthesizer.isSpeaking || synthesizer.isPaused {
            synthesizer.stopSpeaking(at: .immediate)
        }
        audioPlayer?.stop()
        audioPlayer = nil
        engine = .none
        state = .idle
        if resetMessage {
            statusMessage = openAIKey.isEmpty
                ? "Tap Listen — add an API key for a natural OpenAI museum voice"
                : "Tap Listen for a natural museum-style audio guide"
        }
    }

    private func speakWithOpenAI(_ text: String) {
        engine = .openAI
        let chunks = Self.splitChunks(text, maxLen: Self.maxChunkChars)
        state = .preparing
        statusMessage = "Preparing OpenAI museum voice…"

        speakTask = Task { [weak self] in
            guard let self else { return }
            await self.playOpenAIChunks(chunks)
        }
    }

    private func playOpenAIChunks(_ chunks: [String]) async {
        let client = OpenAIClient(apiKey: openAIKey, model: "gpt-4o")

        for (index, chunk) in chunks.enumerated() {
            if Task.isCancelled { return }

            state = .preparing
            statusMessage = index == 0
                ? "Preparing OpenAI museum voice…"
                : "Preparing next part…"

            let models = resolvedTtsModel.map { [$0] } ?? [Self.preferredTtsModel, Self.fallbackTtsModel]
            var audioData: Data?
            var lastError: String?

            for model in models {
                if Task.isCancelled { return }
                let result = await client.createSpeech(
                    input: chunk,
                    voice: openAIVoice,
                    speed: 0.92,
                    model: model,
                    instructions: model.contains("gpt-4o") ? Self.museumInstructions : nil
                )
                switch result {
                case .success(let data):
                    resolvedTtsModel = model
                    audioData = data
                case .failure(let error):
                    lastError = error.localizedDescription
                    let msg = error.localizedDescription.lowercased()
                    let tryNext = msg.contains("model") || msg.contains("not found") || msg.contains("does not exist")
                    if !tryNext { break }
                    continue
                }
                if audioData != nil { break }
            }

            if Task.isCancelled { return }

            guard let audioData, !audioData.isEmpty else {
                let remaining = chunks[index...].joined(separator: "\n\n")
                statusMessage = "OpenAI voice unavailable\(lastError.map { " (\($0))" } ?? "") — using on-device voice."
                speakWithDevice(remaining)
                return
            }

            do {
                let player = try AVAudioPlayer(data: audioData)
                player.delegate = self
                player.prepareToPlay()
                audioPlayer = player
                state = .speaking
                statusMessage = "Listening · OpenAI \(openAIVoice)"
                player.play()
                await waitUntilCurrentClipEnds()
                if Task.isCancelled { return }
            } catch {
                let remaining = chunks[index...].joined(separator: "\n\n")
                statusMessage = "Could not play OpenAI audio — using on-device voice."
                speakWithDevice(remaining)
                return
            }

            if index < chunks.count - 1 {
                try? await Task.sleep(nanoseconds: 380_000_000)
            }
        }

        if !Task.isCancelled {
            engine = .none
            audioPlayer = nil
            state = .idle
            statusMessage = "Tap Listen for a natural museum-style audio guide"
        }
    }

    private func waitUntilCurrentClipEnds() async {
        await withCheckedContinuation { continuation in
            playbackContinuation = continuation
        }
    }

    private func finishPlaybackWait() {
        if let continuation = playbackContinuation {
            playbackContinuation = nil
            continuation.resume()
        }
    }

    private func speakWithDevice(_ text: String) {
        engine = .device
        preferredDeviceVoice = Self.pickMuseumVoice(from: AVSpeechSynthesisVoice.speechVoices())
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = preferredDeviceVoice
            ?? AVSpeechSynthesisVoice(language: "en-GB")
            ?? AVSpeechSynthesisVoice(language: "en-US")
        utterance.rate = 0.42
        utterance.pitchMultiplier = 0.96
        utterance.volume = 1.0
        state = .speaking
        statusMessage = deviceVoiceHint()
        synthesizer.speak(utterance)
    }

    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
            try session.setActive(true, options: [])
        } catch {
            statusMessage = "Could not start audio: \(error.localizedDescription)"
        }
    }

    private func deviceVoiceHint() -> String {
        if let preferredDeviceVoice {
            return "Listening · \(preferredDeviceVoice.name) (on-device)"
        }
        return "Listening · on-device English guide"
    }

    private static func splitChunks(_ text: String, maxLen: Int) -> [String] {
        let paragraphs = text
            .components(separatedBy: "\n\n")
            .map {
                $0.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
                    .trimmingCharacters(in: .whitespacesAndNewlines)
            }
            .filter { !$0.isEmpty }

        var chunks: [String] = []
        for para in paragraphs {
            if para.count <= maxLen {
                chunks.append(para)
                continue
            }
            var buf = ""
            let sentences = para.split(usingRegex: #"(?<=[.!?])\s+"#)
            for sentence in sentences {
                let piece = sentence.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !piece.isEmpty else { continue }
                if !buf.isEmpty && (buf.count + 1 + piece.count) > maxLen {
                    chunks.append(buf)
                    buf = piece
                    while buf.count > maxLen {
                        let idx = buf.index(buf.startIndex, offsetBy: maxLen)
                        chunks.append(String(buf[..<idx]))
                        buf = String(buf[idx...])
                    }
                } else {
                    buf = buf.isEmpty ? piece : buf + " " + piece
                }
            }
            if !buf.isEmpty { chunks.append(buf) }
        }
        return chunks.isEmpty ? [text] : chunks
    }

    private static func pickMuseumVoice(from voices: [AVSpeechSynthesisVoice]) -> AVSpeechSynthesisVoice? {
        let rankedNeedles: [(String, Int)] = [
            ("samantha", 40), ("karen", 38), ("moira", 36), ("daniel", 34),
            ("serena", 32), ("kate", 30), ("aria", 28), ("jenny", 26)
        ]
        var best: AVSpeechSynthesisVoice?
        var bestScore = -1
        for voice in voices {
            let lang = voice.language.lowercased()
            guard lang.hasPrefix("en") else { continue }
            let name = voice.name.lowercased()
            var score = lang.hasPrefix("en-gb") ? 14 : (lang.hasPrefix("en-us") ? 12 : 6)
            if name.contains("enhanced") || name.contains("premium") { score += 25 }
            if voice.quality == .enhanced { score += 20 }
            for (needle, weight) in rankedNeedles where name.contains(needle) {
                score += weight
                break
            }
            if score > bestScore {
                bestScore = score
                best = voice
            }
        }
        return best
    }

    static func cleanForSpeech(_ raw: String) -> String {
        var text = raw
        text = text.replacingOccurrences(
            of: #"\n\s*(?:#{1,6}\s*)?(?:sources?|citations?|references?|further reading|bibliography)\s*:?\s*\n[\s\S]*$"#,
            with: "\n",
            options: .regularExpression
        )
        text = text.replacingOccurrences(
            of: #"\[([^\]]+)\]\((?:https?:\/\/|www\.)[^)]+\)"#,
            with: "$1",
            options: .regularExpression
        )
        text = text.replacingOccurrences(
            of: #"https?:\/\/[^\s<>\[\]()"'`]+"#,
            with: " ",
            options: .regularExpression
        )
        text = text.replacingOccurrences(of: #"\*\*([^*]+)\*\*"#, with: "$1", options: .regularExpression)
        text = text.replacingOccurrences(of: #"\*([^*]+)\*"#, with: "$1", options: .regularExpression)
        text = text.replacingOccurrences(of: #"^#{1,6}\s+"#, with: "", options: .regularExpression)
        text = text.replacingOccurrences(of: #"[ \t]{2,}"#, with: " ", options: .regularExpression)
        text = text.replacingOccurrences(of: #"\n{3,}"#, with: "\n\n", options: .regularExpression)
        return text.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

extension MuseumGuideNarrator: AVSpeechSynthesizerDelegate {
    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
        Task { @MainActor in
            self.engine = .none
            self.state = .idle
            self.statusMessage = "Tap Listen for a natural museum-style audio guide"
        }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor in
            if self.engine == .device {
                self.state = .idle
            }
        }
    }
}

extension MuseumGuideNarrator: AVAudioPlayerDelegate {
    nonisolated func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
        Task { @MainActor in
            self.finishPlaybackWait()
        }
    }

    nonisolated func audioPlayerDecodeErrorDidOccur(_ player: AVAudioPlayer, error: Error?) {
        Task { @MainActor in
            self.finishPlaybackWait()
        }
    }
}

private extension String {
    func split(usingRegex pattern: String) -> [String] {
        guard let regex = try? NSRegularExpression(pattern: pattern) else { return [self] }
        let range = NSRange(startIndex..., in: self)
        let matches = regex.matches(in: self, range: range)
        var result: [String] = []
        var last = startIndex
        for match in matches {
            guard let mr = Range(match.range, in: self) else { continue }
            result.append(String(self[last..<mr.lowerBound]))
            last = mr.upperBound
        }
        result.append(String(self[last...]))
        return result.filter { !$0.isEmpty }
    }
}
