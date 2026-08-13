import Foundation

struct OpenAIClient {
    var apiKey: String
    var model: String
    var baseURL = "https://api.openai.com/v1"

    func createResponse(
        instructions: String,
        input: String,
        tools: [[String: Any]] = [],
        temperature: Double = 0.3,
        maxOutputTokens: Int = 2500
    ) async -> Result<String, Error> {
        var body: [String: Any] = [
            "model": model,
            "instructions": instructions,
            "input": input,
            "temperature": temperature,
            "max_output_tokens": maxOutputTokens
        ]
        if !tools.isEmpty {
            body["tools"] = tools
        }
        return await postJSON(path: "/responses", body: body) { json in
            Self.extractResponsesText(json)
        }
    }

    func createChatCompletion(
        messages: [[String: String]],
        temperature: Double = 0.4,
        maxTokens: Int = 2000
    ) async -> Result<String, Error> {
        let body: [String: Any] = [
            "model": model,
            "temperature": temperature,
            "max_tokens": maxTokens,
            "messages": messages,
            "response_format": ["type": "json_object"]
        ]
        return await postJSON(path: "/chat/completions", body: body) { json in
            (((json["choices"] as? [[String: Any]])?.first?["message"] as? [String: Any])?["content"] as? String)
        }
    }

    /// OpenAI Text-to-Speech → mp3 data for museum-style Listen narration.
    func createSpeech(
        input: String,
        voice: String = "nova",
        speed: Double = 0.92,
        model: String = "gpt-4o-mini-tts",
        instructions: String? = nil
    ) async -> Result<Data, Error> {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !apiKey.isEmpty else { return .failure(OpenAIError.http(401, "Missing API key")) }
        guard !text.isEmpty else { return .failure(OpenAIError.empty) }
        guard let url = URL(string: baseURL + "/audio/speech") else {
            return .failure(OpenAIError.badURL)
        }

        var body: [String: Any] = [
            "model": model,
            "input": text,
            "voice": voice,
            "speed": speed,
            "response_format": "mp3"
        ]
        if let instructions, model.contains("gpt-4o") {
            body["instructions"] = instructions
        }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("audio/mpeg, application/octet-stream, application/json", forHTTPHeaderField: "Accept")
        request.timeoutInterval = 90

        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            let (data, response) = try await URLSession.shared.data(for: request)
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            if !(200..<300).contains(code) {
                let json = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
                let msg = ((json["error"] as? [String: Any])?["message"] as? String)
                    ?? "OpenAI TTS HTTP \(code)"
                return .failure(OpenAIError.http(code, msg))
            }
            guard !data.isEmpty else { return .failure(OpenAIError.empty) }
            return .success(data)
        } catch {
            return .failure(error)
        }
    }

    private func postJSON(
        path: String,
        body: [String: Any],
        extract: ([String: Any]) -> String?
    ) async -> Result<String, Error> {
        guard let url = URL(string: baseURL + path) else {
            return .failure(OpenAIError.badURL)
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.timeoutInterval = 90
        do {
            request.httpBody = try JSONSerialization.data(withJSONObject: body)
            let (data, response) = try await URLSession.shared.data(for: request)
            let code = (response as? HTTPURLResponse)?.statusCode ?? 0
            let json = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
            if !(200..<300).contains(code) {
                let msg = ((json["error"] as? [String: Any])?["message"] as? String)
                    ?? "OpenAI HTTP \(code)"
                return .failure(OpenAIError.http(code, msg))
            }
            guard let text = extract(json), !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                return .failure(OpenAIError.empty)
            }
            return .success(text)
        } catch {
            return .failure(error)
        }
    }

    private static func extractResponsesText(_ json: [String: Any]) -> String? {
        if let outputText = json["output_text"] as? String, !outputText.isEmpty {
            return outputText
        }
        guard let output = json["output"] as? [[String: Any]] else { return nil }
        var chunks: [String] = []
        for item in output {
            guard let content = item["content"] as? [[String: Any]] else { continue }
            for part in content {
                if let text = part["text"] as? String {
                    chunks.append(text)
                } else if let text = (part["output_text"] as? String) {
                    chunks.append(text)
                }
            }
        }
        let joined = chunks.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        return joined.isEmpty ? nil : joined
    }
}

enum OpenAIError: LocalizedError {
    case badURL
    case empty
    case http(Int, String)

    var errorDescription: String? {
        switch self {
        case .badURL: return "Invalid OpenAI URL"
        case .empty: return "Empty model response"
        case .http(_, let message): return message
        }
    }
}
