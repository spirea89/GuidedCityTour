import Foundation
import CoreLocation

enum LandmarkDiscoveryError: LocalizedError {
    case missingKey
    case noPlaces
    case failed(String)

    var errorDescription: String? {
        switch self {
        case .missingKey:
            return "Add an OpenAI API key in Settings so the guide can pick the important buildings."
        case .noPlaces:
            return "No notable buildings were found for this area. Try a wider radius or another neighbourhood."
        case .failed(let message):
            return message
        }
    }
}

struct LandmarkDiscoveryService {
    var apiKey: String
    var model: String

    private let maxPins = 10

    func discover(
        center: CLLocationCoordinate2D,
        radius: Double,
        areaLabel: String
    ) async throws -> [GameBuilding] {
        let key = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !key.isEmpty else { throw LandmarkDiscoveryError.missingKey }

        let areaKey = SupabaseCacheService.areaCacheKey(
            center: center,
            radius: radius,
            areaLabel: areaLabel,
            model: model
        )
        if let cached = await SupabaseCacheService.fetchAreaPlaces(cacheKey: areaKey) {
            return cached
        }

        let client = OpenAIClient(apiKey: key, model: model)
        let input = userPrompt(center: center, radius: radius, areaLabel: areaLabel)

        let withSearch = await client.createResponse(
            instructions: Self.instructions,
            input: input,
            tools: [["type": "web_search"]],
            temperature: 0.2,
            maxOutputTokens: 1200
        )

        let raw: String
        switch withSearch {
        case .success(let text):
            raw = text
        case .failure:
            let fallback = await client.createChatCompletion(
                messages: [
                    ["role": "system", "content": Self.instructions],
                    ["role": "user", "content": input]
                ],
                temperature: 0.2,
                maxTokens: 1200
            )
            switch fallback {
            case .success(let text):
                raw = text
            case .failure(let error):
                throw LandmarkDiscoveryError.failed(error.localizedDescription)
            }
        }

        let drafts = Self.parsePlaces(raw)
        if drafts.isEmpty {
            throw LandmarkDiscoveryError.noPlaces
        }

        let maxDistance = max(radius * 2.2, 900)
        let limited = Array(drafts.prefix(maxPins))
        var pinned: [GameBuilding?] = Array(repeating: nil, count: limited.count)

        await withTaskGroup(of: (Int, GameBuilding?).self) { group in
            for (index, draft) in limited.enumerated() {
                group.addTask {
                    let building = await self.makeBuilding(
                        draft: draft,
                        index: index,
                        center: center,
                        areaLabel: areaLabel,
                        maxDistance: maxDistance
                    )
                    return (index, building)
                }
            }
            for await (index, building) in group {
                pinned[index] = building
            }
        }

        var seen = Set<String>()
        let unique = pinned.compactMap { $0 }.filter { building in
            let key = building.displayName.lowercased()
            if seen.contains(key) { return false }
            seen.insert(key)
            return true
        }
        if unique.isEmpty { throw LandmarkDiscoveryError.noPlaces }

        await SupabaseCacheService.saveAreaPlaces(
            cacheKey: areaKey,
            center: center,
            radius: radius,
            areaLabel: areaLabel,
            model: model,
            places: unique
        )
        return unique
    }

    private func makeBuilding(
        draft: DraftPlace,
        index: Int,
        center: CLLocationCoordinate2D,
        areaLabel: String,
        maxDistance: Double
    ) async -> GameBuilding? {
        let coordinate = await resolveCoordinate(
            draft: draft,
            center: center,
            areaLabel: areaLabel,
            maxDistance: maxDistance
        )
        guard let coordinate else { return nil }
        let entity = Self.entity(from: draft.type)
        let nameKey = draft.name.lowercased()
        return GameBuilding(
            id: "pin-\(index + 1)-\(nameKey.prefix(24))",
            name: draft.name,
            entityType: entity,
            coordinate: coordinate,
            heightMeters: 16,
            widthMeters: 12,
            depthMeters: 12,
            tags: ["name": draft.name, "discovery": "openai"],
            isLandmark: true,
            typeLabel: draft.type.isEmpty ? entity.displayLabel.lowercased() : draft.type,
            whyNotable: draft.whyNotable,
            osmId: nil,
            osmType: nil
        )
    }

    private func resolveCoordinate(
        draft: DraftPlace,
        center: CLLocationCoordinate2D,
        areaLabel: String,
        maxDistance: Double
    ) async -> CLLocationCoordinate2D? {
        let queries = [
            [draft.name, areaLabel].filter { !$0.isEmpty }.joined(separator: ", "),
            draft.name
        ]
        for query in queries {
            if let hits = try? await GeocoderService.search(query, near: center, limit: 3) {
                if let hit = hits.first(where: {
                    Geo.haversineMeters(center, $0.coordinate) <= maxDistance
                }) {
                    return hit.coordinate
                }
            }
        }

        if let lat = draft.lat, let lng = draft.lng,
           lat != 0 || lng != 0,
           abs(lat) <= 90, abs(lng) <= 180
        {
            let proposed = CLLocationCoordinate2D(latitude: lat, longitude: lng)
            if Geo.haversineMeters(center, proposed) <= maxDistance {
                return proposed
            }
        }
        return nil
    }

    private func userPrompt(center: CLLocationCoordinate2D, radius: Double, areaLabel: String) -> String {
        """
        Map area to research:
        - Label: \(areaLabel.isEmpty ? "Unknown neighbourhood" : areaLabel)
        - Center: \(center.latitude), \(center.longitude)
        - Radius: \(Int(radius)) meters

        Return the \(maxPins) most important buildings, monuments, churches, museums, palaces, or civic landmarks a visitor should know in this area. Skip shops, apartments, and generic streets.

        JSON only:
        {"places":[{"name":"","type":"church|museum|monument|palace|landmark|building","why_notable":"one sentence","lat":0,"lng":0}]}
        """
    }

    private static let instructions = """
    You pick notable buildings and monuments for a walking city guide.
    Use web search when available. Prefer official / well-known heritage sites.
    Do not invent obscure buildings. Names must be real places in that neighbourhood.
    Coordinates should be as accurate as you can make them.
    Output a single JSON object. No markdown.
    """

    private struct DraftPlace {
        var name: String
        var type: String
        var whyNotable: String
        var lat: Double?
        var lng: Double?
    }

    private static func parsePlaces(_ raw: String) -> [DraftPlace] {
        let jsonText = extractJSON(raw)
        guard let data = jsonText.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let arr = obj["places"] as? [[String: Any]]
        else { return [] }

        return arr.compactMap { item in
            let name = (item["name"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard name.count >= 2 else { return nil }
            return DraftPlace(
                name: name,
                type: (item["type"] as? String ?? "landmark").lowercased(),
                whyNotable: (item["why_notable"] as? String ?? item["whyNotable"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines),
                lat: item["lat"] as? Double,
                lng: (item["lng"] as? Double) ?? (item["lon"] as? Double)
            )
        }
    }

    private static func extractJSON(_ raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasPrefix("{") { return trimmed }
        if let start = trimmed.firstIndex(of: "{"), let end = trimmed.lastIndex(of: "}") {
            return String(trimmed[start...end])
        }
        return trimmed
    }

    private static func entity(from type: String) -> EntityType {
        let t = type.lowercased()
        if t.contains("church") || t.contains("cathedral") || t.contains("mosque") || t.contains("temple") {
            return .church
        }
        if t.contains("museum") || t.contains("gallery") { return .museum }
        if t.contains("castle") || t.contains("palace") || t.contains("fort") { return .castle }
        if t.contains("statue") || t.contains("monument") || t.contains("memorial") { return .statue }
        if t.contains("street") { return .street }
        return .landmark
    }
}
