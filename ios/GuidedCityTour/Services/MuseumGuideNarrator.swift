import Foundation
import AVFoundation
import Observation

/// On-device museum audio-guide narration using AVSpeechSynthesizer.
@MainActor
@Observable
final class MuseumGuideNarrator: NSObject {
    enum State: Equatable {
        case idle
        case speaking
        case paused
    }

    var state: State = .idle
    var statusMessage = "Tap Listen for a museum-style audio guide"

    private let synthesizer = AVSpeechSynthesizer()
    private var preferredVoice: AVSpeechSynthesisVoice?
    private var voicesReady = false

    override init() {
        super.init()
        synthesizer.delegate = self
        refreshVoices()
    }

    var isSpeaking: Bool { state == .speaking }
    var isPaused: Bool { state == .paused }
    var canPause: Bool { state == .speaking || state == .paused }

    func speak(_ raw: String) {
        let text = Self.cleanForSpeech(raw)
        guard !text.isEmpty else {
            statusMessage = "Nothing to narrate yet."
            return
        }

        stop()
        configureAudioSession()
        refreshVoices()

        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = preferredVoice ?? AVSpeechSynthesisVoice(language: "en-US")
        // Museum pacing: calm and slightly slow (AVSpeech default is ~0.5).
        utterance.rate = 0.42
        utterance.pitchMultiplier = 0.96
        utterance.volume = 1.0
        utterance.preUtteranceDelay = 0.15
        utterance.postUtteranceDelay = 0.2

        state = .speaking
        statusMessage = voiceHint()
        synthesizer.speak(utterance)
    }

    func togglePause() {
        if synthesizer.isSpeaking && !synthesizer.isPaused {
            synthesizer.pauseSpeaking(at: .word)
            state = .paused
            statusMessage = "Paused — tap Resume to continue."
        } else if synthesizer.isPaused {
            synthesizer.continueSpeaking()
            state = .speaking
            statusMessage = voiceHint()
        }
    }

    func stop() {
        if synthesizer.isSpeaking || synthesizer.isPaused {
            synthesizer.stopSpeaking(at: .immediate)
        }
        state = .idle
        statusMessage = "Tap Listen for a museum-style audio guide"
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

    private func refreshVoices() {
        let voices = AVSpeechSynthesisVoice.speechVoices()
        preferredVoice = Self.pickMuseumVoice(from: voices)
        voicesReady = preferredVoice != nil
    }

    private func voiceHint() -> String {
        if let preferredVoice {
            return "Listening · \(preferredVoice.name)"
        }
        return "Listening · system English guide"
    }

    /// Prefer calm, clear English voices museums typically use on iOS.
    private static func pickMuseumVoice(from voices: [AVSpeechSynthesisVoice]) -> AVSpeechSynthesisVoice? {
        let rankedNeedles: [(String, Int)] = [
            ("samantha", 40),
            ("karen", 38),
            ("moira", 36),
            ("daniel", 34),
            ("serena", 32),
            ("kate", 30),
            ("martha", 28),
            ("aria", 28),
            ("jenny", 26),
            ("ava", 26),
            ("zoe", 24),
            ("allison", 22),
            ("susan", 20),
            ("oliver", 18),
            ("aaron", 16)
        ]

        var best: AVSpeechSynthesisVoice?
        var bestScore = -1

        for voice in voices {
            let lang = voice.language.lowercased()
            guard lang.hasPrefix("en") else { continue }
            let name = voice.name.lowercased()
            var score = 0

            if lang == "en-us" || lang.hasPrefix("en-us") { score += 12 }
            else if lang == "en-gb" || lang.hasPrefix("en-gb") { score += 14 }
            else if lang == "en-au" || lang.hasPrefix("en-au") { score += 11 }
            else if lang == "en-ie" || lang.hasPrefix("en-ie") { score += 10 }
            else { score += 4 }

            // Prefer Enhanced / Premium / Quality voices when the user has downloaded them.
            if name.contains("enhanced") || name.contains("premium") || name.contains("quality") {
                score += 25
            }
            if voice.quality == .enhanced {
                score += 20
            }

            for (needle, weight) in rankedNeedles {
                if name.contains(needle) {
                    score += weight
                    break
                }
            }

            // Avoid novelty / character voices.
            if name.contains("novelty") || name.contains("whisper") || name.contains("zarvox") {
                score -= 80
            }

            if score > bestScore {
                bestScore = score
                best = voice
            }
        }
        return bestScore > 0 ? best : AVSpeechSynthesisVoice(language: "en-GB")
            ?? AVSpeechSynthesisVoice(language: "en-US")
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
            self.state = .idle
            self.statusMessage = "Tap Listen for a museum-style audio guide"
        }
    }

    nonisolated func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
        Task { @MainActor in
            self.state = .idle
            self.statusMessage = "Tap Listen for a museum-style audio guide"
        }
    }
}
