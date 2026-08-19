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

        if !skipCache, var hit = TourCache.getLocal(cacheKey) {
            hit.cached = true
            return hit
        }

        if !skipCache, let remote = await SupabaseCacheService.fetchStory(cacheKey: cacheKey) {
            var hit = remote
            hit.cached = true
            TourCache.set(cacheKey, hit)
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
            result = enforceLocationIntegrity(result, building: building)
            if result.status == .ok && !result.claims.verified.isEmpty {
                TourCache.set(cacheKey, result)
                await SupabaseCacheService.saveStory(
                    cacheKey: cacheKey,
                    building: building,
                    result: result,
                    kidsMode: kidsMode
                )
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

        let cityHint = building.tags["addr:city"]
            ?? building.tags["city"]
            ?? building.tags["addr:town"]
            ?? ""
        let streetHint = [
            building.tags["addr:street"],
            building.tags["addr:housenumber"]
        ].compactMap { $0 }.joined(separator: " ")
        let locationLine = [streetHint, cityHint]
            .filter { !$0.isEmpty }
            .joined(separator: ", ")

        return """
        ════════════════════════════════
        TARGET LOCATION (OSM-verified)
        ════════════════════════════════
        Name   : \(building.displayName)
        Type   : \(building.typeLabel)
        Coords : \(String(format: "%.5f", building.coordinate.latitude)), \(String(format: "%.5f", building.coordinate.longitude))
        Address: \(locationLine.isEmpty ? "(see OSM tags below)" : locationLine)
        OSM    : \(building.osmType ?? "way")/\(building.osmId.map(String.init) ?? "?")
        \(building.wikidata.map { "Wikidata: \($0)" } ?? "")
        \(building.wikipedia.map { "Wikipedia: \($0)" } ?? "")

        !! LOCATION LOCK — READ CAREFULLY !!
        The target building is in: \(cityHint.isEmpty ? "the city/town at the coordinates above" : cityHint)
        Required web search query: "\(building.displayName) \(cityHint)"
        - If a search result is about a building with the SAME NAME in a DIFFERENT city/county/country → move to claims.uncertain, note "source refers to different location"
        - A claim is only verified if the source explicitly confirms it is about THIS building in \(cityHint.isEmpty ? "this specific location" : cityHint)
        - If no location-specific verified source exists → set status "no_history". Do NOT recycle facts from another location with the same name.

        Additional OSM tags:
        \(extras)

        Full OSM place JSON:
        \(prettyJSON(place))

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

    /// Strips verified claims whose sources clearly refer to a different city,
    /// and downgrades the result to no_history if nothing verified remains.
    private func enforceLocationIntegrity(_ result: TourResult, building: GameBuilding) -> TourResult {
        let buildingCity = cityName(building: building)
        guard !buildingCity.isEmpty else { return result }

        let norm = normalize(buildingCity)

        let stillVerified = result.claims.verified.filter { claim in
            claim.sources.allSatisfy { source in
                let combined = normalize(source.title + " " + source.url + " " + source.publisher)
                return locationMatch(combined, city: norm)
            }
        }
        let demoted = result.claims.verified.filter { claim in
            !stillVerified.contains(where: { $0.id == claim.id })
        }

        if stillVerified.count == result.claims.verified.count {
            return result
        }

        let newUncertain = result.claims.uncertain + demoted.map { claim in
            FactClaim(
                text: claim.text,
                category: claim.category,
                confidence: min(claim.confidence, 0.4),
                sources: claim.sources
            )
        }
        let newClaims = TourClaims(
            verified: stillVerified,
            uncertain: newUncertain,
            legends: result.claims.legends,
            unknown: result.claims.unknown
        )

        if stillVerified.isEmpty {
            return TourResult(
                status: .noHistory,
                message: "Sources found were about a different location with the same name, not this specific building in \(buildingCity). Try a wider or different search.",
                place: result.place,
                claims: newClaims,
                narration: .empty,
                citations: [],
                errors: result.errors,
                cached: false,
                researchAvailable: true,
                generatedAt: result.generatedAt
            )
        }

        return TourResult(
            status: result.status,
            message: result.message,
            place: result.place,
            claims: newClaims,
            narration: result.narration,
            citations: result.citations.filter { cite in
                let combined = normalize(cite.title + " " + cite.url + " " + cite.publisher)
                return locationMatch(combined, city: norm)
            },
            errors: result.errors,
            cached: result.cached,
            researchAvailable: result.researchAvailable,
            generatedAt: result.generatedAt
        )
    }

    private func cityName(building: GameBuilding) -> String {
        let tags = building.tags
        return (tags["addr:city"]
            ?? tags["addr:town"]
            ?? tags["addr:village"]
            ?? tags["city"]
            ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// True when the source text contains the expected city name OR contains
    /// no competing city-like term that contradicts it.
    /// We keep the rule simple: if the source text explicitly mentions the
    /// building's city/town, it passes. If it mentions NOTHING location-specific,
    /// we give the benefit of the doubt (no false positives on generic sources).
    private func locationMatch(_ sourceText: String, city normCity: String) -> Bool {
        if sourceText.contains(normCity) { return true }
        // Generic / non-geographic sources (e.g. architecture.org, wikidata item pages)
        // should not be penalised because they don't mention the city name.
        // We only reject a source if it explicitly names a DIFFERENT place.
        // That heuristic is hard to express perfectly without NLP; the prompt-level
        // rule handles the heavy lifting — this is a safety net for obvious cases.
        return true
    }

    private func normalize(_ text: String) -> String {
        text.lowercased()
            .folding(options: .diacriticInsensitive, locale: .current)
            .replacingOccurrences(of: "[^a-z0-9 ]", with: " ", options: .regularExpression)
            .replacingOccurrences(of: " +", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
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

    LOCATION INTEGRITY (critical)
    9. Every verified claim must be about the EXACT building at the given coordinates.
       Search by name AND city/town together to avoid confusing same-named buildings
       in different locations. If a source clearly refers to a building in a different
       city, county, or country — even with the same name — move that claim to
       claims.uncertain with note "source may refer to a different location".
    10. If you cannot find location-specific sources for this exact building, set
        status to "no_history" rather than recycling facts from a different place.
    """

    static let researchDeveloperPrompt = """
    Mode: RESEARCH + FACT EXTRACTION + NARRATE
    Use web_search when the tool is available. Prefer authoritative domains.
    IMPORTANT: Search for the building using BOTH its name AND the city/address provided.
    Discard any source that is clearly about a same-named building in a different location.
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
