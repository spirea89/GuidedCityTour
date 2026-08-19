import Foundation
import CoreLocation

enum LandmarkDiscoveryError: LocalizedError {
    case missingKey
    case noPlaces
    case noStoryPlaces
    case failed(String)

    var errorDescription: String? {
        switch self {
        case .missingKey:
            return "Add an OpenAI API key in Settings so the guide can pick the important buildings."
        case .noPlaces:
            return "No notable buildings were found for this area. Try a wider radius or another neighbourhood."
        case .noStoryPlaces:
            return "No buildings with a verified story were found in this radius. Try extending the search radius."
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
        areaLabel: String,
        kidsMode: Bool
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

        let osmLandmarks = (try? await OverpassService.shared.fetchNamedLandmarks(
            center: center,
            radius: radius
        )) ?? []
        guard !osmLandmarks.isEmpty else { throw LandmarkDiscoveryError.noPlaces }

        let client = OpenAIClient(apiKey: key, model: model)
        let input = userPrompt(
            center: center,
            radius: radius,
            areaLabel: areaLabel,
            candidates: osmLandmarks
        )

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

        var seen = Set<String>()
        let unique = drafts.compactMap { draft in
            makeBuilding(draft: draft, osmLandmarks: osmLandmarks)
        }.filter { building in
            let key = PlaceNameMatching.normalize(building.displayName)
            if seen.contains(key) { return false }
            seen.insert(key)
            return true
        }
        if unique.isEmpty { throw LandmarkDiscoveryError.noPlaces }

        let storyBacked = await filterStoryBackedPlaces(
            unique,
            apiKey: key,
            kidsMode: kidsMode
        )
        if storyBacked.isEmpty { throw LandmarkDiscoveryError.noStoryPlaces }

        await SupabaseCacheService.saveAreaPlaces(
            cacheKey: areaKey,
            center: center,
            radius: radius,
            areaLabel: areaLabel,
            model: model,
            places: storyBacked
        )
        return storyBacked
    }

    private func makeBuilding(
        draft: DraftPlace,
        osmLandmarks: [GameBuilding]
    ) -> GameBuilding? {
        guard let osm = osmLandmarks.first(where: { $0.id == draft.id }) else { return nil }
        return building(from: osm, draft: draft, source: "osm")
    }

    private func building(
        from osm: GameBuilding,
        draft: DraftPlace,
        source: String
    ) -> GameBuilding {
        var tags = osm.tags
        tags["name"] = osm.name
        tags["discovery"] = source
        if !draft.address.isEmpty { tags["address"] = draft.address }
        let entity = Self.entity(from: draft.type)
        return GameBuilding(
            id: osm.id,
            name: osm.name,
            entityType: osm.entityType == .unknown ? entity : osm.entityType,
            coordinate: osm.coordinate,
            heightMeters: osm.heightMeters,
            widthMeters: osm.widthMeters,
            depthMeters: osm.depthMeters,
            tags: tags,
            isLandmark: true,
            typeLabel: draft.type.isEmpty ? osm.typeLabel : draft.type,
            whyNotable: draft.whyNotable,
            osmId: osm.osmId,
            osmType: osm.osmType
        )
    }

    private func filterStoryBackedPlaces(
        _ buildings: [GameBuilding],
        apiKey: String,
        kidsMode: Bool
    ) async -> [GameBuilding] {
        let pipeline = TourPipeline(
            apiKey: apiKey,
            model: model,
            kidsMode: kidsMode
        )

        var accepted: [GameBuilding] = []
        for building in buildings {
            let nearby = buildings.filter { $0.id != building.id }
            let result = await pipeline.run(building: building, nearby: nearby)
            if result.status == .ok, !result.claims.verified.isEmpty {
                accepted.append(building)
            }
        }
        return accepted
    }

    private func userPrompt(
        center: CLLocationCoordinate2D,
        radius: Double,
        areaLabel: String,
        candidates: [GameBuilding]
    ) -> String {
        let candidateList = candidates.prefix(30).map { building in
            let dist = Int(Geo.haversineMeters(center, building.coordinate).rounded())
            let address = building.tags["addr:street"].map { street in
                if let house = building.tags["addr:housenumber"], !house.isEmpty {
                    return "\(street) \(house)"
                }
                return street
            } ?? ""
            return """
            - id: \(building.id)
              name: \(building.displayName)
              type: \(building.typeLabel)
              distance_m: \(dist)
              address: \(address)
            """
        }.joined(separator: "\n")

        """
        Map area to research:
        - Label: \(areaLabel.isEmpty ? "Unknown neighbourhood" : areaLabel)
        - Center: \(center.latitude), \(center.longitude)
        - Radius: \(Int(radius)) meters (hard limit — every place MUST lie inside this circle)

        List up to \(maxPins) genuinely important buildings, monuments, churches, museums, palaces, or civic landmarks inside this radius.
        Return FEWER places if there are not enough notable ones — do NOT pad the list to reach \(maxPins).
        Skip shops, apartments, and generic streets.

        Choose only from the OpenStreetMap candidates below. Do not invent new names or ids. Return FEWER places if none are important enough.

        OpenStreetMap candidates:
        \(candidateList)

        JSON only:
        {"places":[{"id":"","name":"","address":"","type":"church|museum|monument|palace|landmark|building","why_notable":"one sentence"}]}
        """
    }

    private static let instructions = """
    You pick notable buildings and monuments for a walking city guide.
    Use web search when available. Prefer official / well-known heritage sites.
    Do not invent obscure buildings. Names must be real places in that neighbourhood.
    Every place must fall within the requested radius from the center point.
    Only choose places from the provided OpenStreetMap candidate list. Never invent a new place name or id.
    Include street addresses when known.
    Return fewer items rather than guessing locations. Output a single JSON object. No markdown.
    """

    private struct DraftPlace {
        var id: String
        var name: String
        var address: String
        var type: String
        var whyNotable: String
    }

    private static func parsePlaces(_ raw: String) -> [DraftPlace] {
        let jsonText = extractJSON(raw)
        guard let data = jsonText.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let arr = obj["places"] as? [[String: Any]]
        else { return [] }

        return arr.compactMap { item in
            let id = (item["id"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let name = (item["name"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard id.count >= 2, name.count >= 2 else { return nil }
            return DraftPlace(
                id: id,
                name: name,
                address: (item["address"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines),
                type: (item["type"] as? String ?? "landmark").lowercased(),
                whyNotable: (item["why_notable"] as? String ?? item["whyNotable"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            )
        }.prefix(10).map { $0 }
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
