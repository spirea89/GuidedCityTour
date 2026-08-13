import Foundation
import CoreLocation

struct TourPipeline {
    var apiKey: String
    var model: String
    var kidsMode: Bool

    func run(
        building: GameBuilding,
        nearby: [GameBuilding],
        skipCache: Bool = false
    ) async -> TourResult {
        let place = identify(building: building, nearby: nearby)
        let cacheKey = TourCache.key(building: building, kids: kidsMode, model: model)

        if !skipCache, var hit = TourCache.get(cacheKey) {
            hit.cached = true
            return hit
        }

        guard !apiKey.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return TourResult.error("Add an OpenAI API key in Settings to research this building.", place: place)
        }

        let client = OpenAIClient(apiKey: apiKey, model: model)
        let instructions = Self.systemPrompt + "\n\n" + Self.researchDeveloperPrompt
        let input = userPrompt(place: place, building: building)

        let withSearch = await client.createResponse(
            instructions: instructions,
            input: input,
            tools: [["type": "web_search"]]
        )

        switch withSearch {
        case .success(let text):
            var result = parse(text, fallbackPlace: place, researchAvailable: true)
            if result.status == .ok && !result.claims.verified.isEmpty {
                TourCache.set(cacheKey, result)
            }
            return result
        case .failure:
            break
        }

        let degraded = await client.createChatCompletion(
            messages: [
                ["role": "system", "content": Self.systemPrompt + "\n\n" + Self.degradedDeveloperPrompt],
                ["role": "user", "content": input]
            ]
        )

        switch degraded {
        case .success(let text):
            return parse(text, fallbackPlace: place, researchAvailable: false)
        case .failure(let error):
            return TourResult.error(error.localizedDescription, place: place)
        }
    }

    func identify(building: GameBuilding, nearby: [GameBuilding]) -> IdentifiedPlace {
        let allow = nearby.filter(\.hasProperName).prefix(8).map {
            NearbyPlace(
                name: $0.displayName,
                distM: Int(Geo.haversineMeters(building.coordinate, $0.coordinate).rounded()),
                type: $0.typeLabel
            )
        }
        let confidence: Double
        if building.hasProperName && building.isLandmark {
            confidence = 0.86
        } else if building.hasProperName {
            confidence = 0.72
        } else {
            confidence = 0.4
        }

        var address: [String: String] = [:]
        for (k, v) in building.tags where ["city", "addr:city", "addr:street", "addr:housenumber", "tourism", "historic", "amenity", "building", "leisure"].contains(k) {
            address[k.replacingOccurrences(of: "addr:", with: "")] = v
        }

        return IdentifiedPlace(
            id: building.id,
            name: building.displayName,
            entityType: building.entityType.rawValue,
            lat: building.coordinate.latitude,
            lng: building.coordinate.longitude,
            address: address,
            displayName: building.displayName,
            identificationConfidence: confidence,
            candidates: [
                PlaceCandidate(
                    name: building.displayName,
                    entityType: building.entityType.rawValue,
                    confidence: confidence,
                    reason: building.isLandmark ? "Named landmark from OpenStreetMap" : "OSM building footprint"
                )
            ],
            nearbyAllowList: Array(allow),
            focusKind: building.isLandmark ? "landmark" : "house",
            focusLabel: building.displayName
        )
    }

    private func userPrompt(place: IdentifiedPlace, building: GameBuilding) -> String {
        let nearbyText: String
        if place.nearbyAllowList.isEmpty {
            nearbyText = "(EMPTY ALLOW-LIST - do NOT invent nearby landmarks.)"
        } else {
            nearbyText = place.nearbyAllowList.enumerated().map { idx, p in
                "  \(idx + 1)) \(p.name) - \(p.distM) m [\(p.type)]"
            }.joined(separator: "\n")
        }

        let extras = [
            building.wikipedia.map { "wikipedia: \($0)" },
            building.wikidata.map { "wikidata: \($0)" },
            "osm: \(building.osmType ?? "way")/\(building.osmId.map(String.init) ?? "?")",
            "type_label: \(building.typeLabel)"
        ].compactMap { $0 }.joined(separator: "\n")

        return """
        Place context (OpenStreetMap identity source):
        \(prettyJSON(place))

        \(extras)

        Focus: \(place.focusKind) - \(place.focusLabel)
        IMPORTANT: Research and narrate THIS building/landmark — a stylized game sketch on the map, not a photoreal copy.

        Nearby allow-list (ONLY these may be called nearby):
        \(nearbyText)

        Categories: history, architecture, famous_people, interesting_facts, today
        Kids mode: \(kidsMode ? "true" : "false")
        Research mode: web_search
        Language: English — write narration.adult, narration.kids, and narration.sections in English.

        Return JSON matching TourResponse schema. Deduplicate citations[] from verified sources.
        """
    }

    private func parse(_ raw: String, fallbackPlace: IdentifiedPlace, researchAvailable: Bool) -> TourResult {
        let jsonText = Self.extractJSON(raw)
        guard let data = jsonText.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
            return TourResult.error("The model did not return valid JSON.", place: fallbackPlace)
        }

        let status = TourStatus(rawValue: obj["status"] as? String ?? "error") ?? .error
        let message = obj["message"] as? String ?? ""
        let narrationObj = obj["narration"] as? [String: Any] ?? [:]
        let sections = (narrationObj["sections"] as? [String: Any])?.compactMapValues { $0 as? String } ?? [:]
        let narration = TourNarration(
            adult: narrationObj["adult"] as? String ?? "",
            kids: narrationObj["kids"] as? String ?? "",
            sections: sections
        )
        let claimsObj = obj["claims"] as? [String: Any] ?? [:]
        let claims = TourClaims(
            verified: Self.parseClaims(claimsObj["verified"] ?? claimsObj["verifiedFacts"]),
            uncertain: Self.parseClaims(claimsObj["uncertain"] ?? claimsObj["uncertainFacts"]),
            legends: Self.parseClaims(claimsObj["legends"]),
            unknown: (claimsObj["unknown"] as? [String]) ?? []
        )
        let citations = Self.parseSources(obj["citations"])

        return TourResult(
            status: status,
            message: message,
            place: fallbackPlace,
            claims: claims,
            narration: narration,
            citations: citations.isEmpty ? claims.verified.flatMap(\.sources) : citations,
            errors: (obj["errors"] as? [String]) ?? [],
            cached: false,
            researchAvailable: researchAvailable,
            generatedAt: ISO8601DateFormatter().string(from: Date())
        )
    }

    private static func parseClaims(_ any: Any?) -> [FactClaim] {
        guard let arr = any as? [[String: Any]] else { return [] }
        return arr.compactMap { item in
            guard let text = item["text"] as? String, !text.isEmpty else { return nil }
            return FactClaim(
                text: text,
                category: item["category"] as? String ?? "history",
                confidence: (item["confidence"] as? Double) ?? 0.5,
                sources: parseSources(item["sources"])
            )
        }
    }

    private static func parseSources(_ any: Any?) -> [ClaimSource] {
        guard let arr = any as? [[String: Any]] else { return [] }
        return arr.compactMap { item in
            let url = item["url"] as? String ?? ""
            let title = item["title"] as? String ?? url
            if title.isEmpty && url.isEmpty { return nil }
            return ClaimSource(
                title: title,
                url: url,
                publisher: item["publisher"] as? String ?? "",
                tier: item["tier"] as? String ?? "other"
            )
        }
    }

    private static func extractJSON(_ raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasPrefix("{") { return trimmed }
        if let start = trimmed.firstIndex(of: "{"),
           let end = trimmed.lastIndex(of: "}")
        {
            return String(trimmed[start...end])
        }
        return trimmed
    }

    private func prettyJSON(_ place: IdentifiedPlace) -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        if let data = try? encoder.encode(place), let text = String(data: data, encoding: .utf8) {
            return text
        }
        return place.name
    }

    static let systemPrompt = """
    You are GuidedCityTour's research-and-narration engine for walking tours.

    ROLE
    - You reason over provided map data and (when available) web-search results.
    - You are NOT the source of truth for history. Verified claims require sources.
    - Prefer official / institutional sources: UNESCO, city government, museums,
      heritage registries, universities, tourism boards, national archives.

    HARD RULES
    1. Never invent dates, people, events, architectural attributions, or nearby landmarks.
    2. "Nearby / adjacent / a short walk" ONLY for names on the OSM allow-list.
    3. Adult narration may use verified claims freely, and may include a clearly labeled "Legends & local stories" section only from claims.legends.
    4. Kids narration: verified claims only; simpler language; no invented stories.
    5. Write ALL narration text in English. Proper nouns may stay local.
    6. Category sections must contain ONLY verified facts for that topic.
    7. Output MUST be a single JSON object. No markdown fences.
    8. If web search is unavailable, do not fill verified claims from model memory.
    """

    static let researchDeveloperPrompt = """
    Mode: RESEARCH + FACT EXTRACTION + NARRATE
    Use web_search when the tool is available. Prefer authoritative domains.
    Extract claims into verified | uncertain | legends | unknown.
    Every verified claim MUST include at least one source {title,url,publisher,tier}.
    Then write narration.adult ONLY from verified (+ labeled legends section).
    Fill narration.sections for history, architecture, famous_people, interesting_facts, today when evidence exists.
    Omit empty sections rather than inventing content.

    SCHEMA:
    {"status":"ok|no_history|web_search_unavailable|error","message":"","place":{"name":"","entity_type":"","lat":0,"lng":0},"claims":{"verified":[{"text":"","category":"history","confidence":0.8,"sources":[{"title":"","url":"","publisher":"","tier":"official"}]}],"uncertain":[],"legends":[],"unknown":[]},"narration":{"adult":"","kids":"","sections":{"history":"","architecture":"","famous_people":"","interesting_facts":"","today":""}},"citations":[{"title":"","url":"","publisher":"","tier":"official"}]}
    """

    static let degradedDeveloperPrompt = """
    Mode: DEGRADED - WEB SEARCH UNAVAILABLE
    You must NOT invent historical facts from training memory.
    Set status to web_search_unavailable.
    claims.verified MUST be []. Put gaps in claims.unknown.
    narration.adult may only describe OSM identity (name, type, tags) and clearly state that historical research was unavailable.
    Write both narrations in English.
    Output a single JSON object.
    """
}
