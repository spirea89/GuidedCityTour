import Foundation
import CoreLocation

struct CachedPlace: Codable, Sendable {
    var id: String
    var name: String
    var entityType: String
    var lat: Double
    var lng: Double
    var typeLabel: String
    var whyNotable: String
    var isLandmark: Bool
    var tags: [String: String]

    init(building: GameBuilding) {
        id = building.id
        name = building.name
        entityType = building.entityType.rawValue
        lat = building.coordinate.latitude
        lng = building.coordinate.longitude
        typeLabel = building.typeLabel
        whyNotable = building.whyNotable
        isLandmark = building.isLandmark
        tags = building.tags
    }

    func toBuilding() -> GameBuilding {
        GameBuilding(
            id: id,
            name: name,
            entityType: EntityType(rawValue: entityType) ?? .landmark,
            coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lng),
            heightMeters: 16,
            widthMeters: 12,
            depthMeters: 12,
            tags: tags,
            isLandmark: isLandmark,
            typeLabel: typeLabel,
            whyNotable: whyNotable,
            osmId: nil,
            osmType: nil
        )
    }
}

enum SupabaseCacheService {
    static var isConfigured: Bool {
        !SupabaseConfig.publishableKey.isEmpty
    }

    // MARK: - Story cache

    static func fetchStory(cacheKey: String) async -> TourResult? {
        guard isConfigured else { return nil }
        let query =
            "?cache_key=eq.\(encode(cacheKey))&select=verified_payload,expires_at&limit=1"
        guard let rows = await restGET(table: SupabaseConfig.storyTable, query: query),
              let row = rows.first,
              let payload = row["verified_payload"],
              !isExpired(row["expires_at"])
        else { return nil }

        return decodeTourResult(payload)
    }

    /// Expire a story that was cached with wrong/off-location content.
    /// Sets expires_at to epoch so RLS hides it immediately on next read.
    static func expireStory(cacheKey: String) async {
        guard isConfigured else { return }
        let query = "?cache_key=eq.\(encode(cacheKey))"
        guard let url = URL(string: SupabaseConfig.projectURL + "/rest/v1/" + SupabaseConfig.storyTable + query)
        else { return }
        var request = URLRequest(url: url)
        request.httpMethod = "PATCH"
        request.httpBody = try? JSONSerialization.data(withJSONObject: ["expires_at": "2000-01-01T00:00:00Z"])
        applyHeaders(&request, prefer: "return=minimal")
        _ = try? await URLSession.shared.data(for: request)
    }

    static func saveStory(
        cacheKey: String,
        building: GameBuilding,
        result: TourResult,
        kidsMode: Bool
    ) async {
        guard isConfigured else { return }
        guard result.status == .ok, !result.claims.verified.isEmpty else { return }
        guard let payload = encodeJSON(result) else { return }

        let now = Date()
        let expires = Calendar.current.date(
            byAdding: .day,
            value: SupabaseConfig.storyTTLDays,
            to: now
        ) ?? now.addingTimeInterval(21 * 86400)

        let nameSlug = building.displayName.lowercased()
            .replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
            .prefix(48)

        var row: [String: Any] = [
            "cache_key": cacheKey,
            "lat": roundCoord(building.coordinate.latitude),
            "lng": roundCoord(building.coordinate.longitude),
            "name_normalized": String(nameSlug),
            "entity_type": building.entityType.rawValue,
            "categories": ["history"],
            "kids_mode": kidsMode,
            "verified_payload": payload,
            "sources": encodeJSONArray(result.citations),
            "confidence": result.place?.identificationConfidence ?? 0.5,
            "pipeline_version": AppIdentity.pipelineVersion,
            "researched_at": iso8601(now),
            "expires_at": iso8601(expires)
        ]
        if let osmId = building.osmId {
            row["place_id"] = "\(building.osmType ?? "way")/\(osmId)"
        }
        let body = [row]

        await restUPSERT(table: SupabaseConfig.storyTable, body: body)
    }

    // MARK: - Area locations cache

    static func areaCacheKey(
        center: CLLocationCoordinate2D,
        radius: Double,
        areaLabel: String,
        model: String
    ) -> String {
        let lat = String(format: "%.5f", center.latitude)
        let lng = String(format: "%.5f", center.longitude)
        let radiusM = Int(radius.rounded())
        let slug = areaLabel.lowercased()
            .replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
            .prefix(32)
        return "gct:v\(AppIdentity.pipelineVersion):area:\(lat):\(lng):\(radiusM):\(slug):\(model)"
    }

    /// Fetches all non-expired area_locations whose center is within `radiusMeters` of `coordinate`.
    /// Returns a merged, deduplicated list of buildings from all matching rows.
    static func fetchNearbyAreaPlaces(
        near coordinate: CLLocationCoordinate2D,
        radiusMeters: Double = 2000
    ) async -> [GameBuilding]? {
        guard isConfigured else { return nil }

        // Rough bounding-box filter (degrees). 1° lat ≈ 111 320 m.
        let deltaLat = radiusMeters / 111_320.0
        let deltaLng = radiusMeters / (111_320.0 * max(cos(coordinate.latitude * .pi / 180), 0.001))
        let minLat = roundCoord(coordinate.latitude - deltaLat)
        let maxLat = roundCoord(coordinate.latitude + deltaLat)
        let minLng = roundCoord(coordinate.longitude - deltaLng)
        let maxLng = roundCoord(coordinate.longitude + deltaLng)

        let query = "?select=center_lat,center_lng,area_label,radius_meters,places,expires_at" +
            "&center_lat=gte.\(minLat)&center_lat=lte.\(maxLat)" +
            "&center_lng=gte.\(minLng)&center_lng=lte.\(maxLng)" +
            "&expires_at=gt.\(iso8601(Date()))" +
            "&limit=12"

        guard let rows = await restGET(table: SupabaseConfig.locationsTable, query: query),
              !rows.isEmpty
        else { return nil }

        var buildings: [GameBuilding] = []
        var seenIds = Set<String>()

        for row in rows {
            guard let placesAny = row["places"],
                  let data = try? JSONSerialization.data(withJSONObject: placesAny),
                  let cached = try? JSONDecoder().decode([CachedPlace].self, from: data)
            else { continue }

            for place in cached {
                let coord = CLLocationCoordinate2D(latitude: place.lat, longitude: place.lng)
                let dist = Geo.haversineMeters(coordinate, coord)
                guard dist <= radiusMeters, !seenIds.contains(place.id) else { continue }
                seenIds.insert(place.id)
                buildings.append(place.toBuilding())
            }
        }

        return buildings.isEmpty ? nil : buildings
    }

    static func fetchAreaPlaces(cacheKey: String) async -> [GameBuilding]? {
        guard isConfigured else { return nil }
        let query =
            "?cache_key=eq.\(encode(cacheKey))&select=places,expires_at&limit=1"
        guard let rows = await restGET(table: SupabaseConfig.locationsTable, query: query),
              let row = rows.first,
              let placesAny = row["places"],
              !isExpired(row["expires_at"]),
              let data = try? JSONSerialization.data(withJSONObject: placesAny),
              let cached = try? JSONDecoder().decode([CachedPlace].self, from: data),
              !cached.isEmpty
        else { return nil }

        return cached.map { $0.toBuilding() }
    }

    static func saveAreaPlaces(
        cacheKey: String,
        center: CLLocationCoordinate2D,
        radius: Double,
        areaLabel: String,
        model: String,
        places: [GameBuilding]
    ) async {
        guard isConfigured, !places.isEmpty else { return }
        let cached = places.map(CachedPlace.init(building:))
        guard let placesJSON = try? JSONEncoder().encode(cached),
              let placesObj = try? JSONSerialization.jsonObject(with: placesJSON)
        else { return }

        let now = Date()
        let expires = Calendar.current.date(
            byAdding: .day,
            value: SupabaseConfig.locationsTTLDays,
            to: now
        ) ?? now.addingTimeInterval(14 * 86400)

        let body: [[String: Any]] = [[
            "cache_key": cacheKey,
            "center_lat": roundCoord(center.latitude),
            "center_lng": roundCoord(center.longitude),
            "radius_meters": Int(radius.rounded()),
            "area_label": areaLabel,
            "places": placesObj,
            "pipeline_version": AppIdentity.pipelineVersion,
            "model": model,
            "researched_at": iso8601(now),
            "expires_at": iso8601(expires)
        ]]

        await restUPSERT(table: SupabaseConfig.locationsTable, body: body)
    }

    // MARK: - REST helpers

    private static func restGET(table: String, query: String) async -> [[String: Any]]? {
        guard let url = URL(string: SupabaseConfig.projectURL + "/rest/v1/" + table + query) else {
            return nil
        }
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.timeoutInterval = 4
        applyHeaders(&request)

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200...299).contains(http.statusCode) else {
                return nil
            }
            guard let arr = try JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
                return nil
            }
            return arr
        } catch {
            return nil
        }
    }

    private static func restUPSERT(table: String, body: [[String: Any]]) async {
        guard let url = URL(string: SupabaseConfig.projectURL + "/rest/v1/" + table) else { return }
        guard let data = try? JSONSerialization.data(withJSONObject: body) else { return }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.httpBody = data
        applyHeaders(&request, prefer: "resolution=merge-duplicates,return=minimal")

        _ = try? await URLSession.shared.data(for: request)
    }

    private static func applyHeaders(_ request: inout URLRequest, prefer: String? = nil) {
        request.setValue(SupabaseConfig.publishableKey, forHTTPHeaderField: "apikey")
        request.setValue("Bearer \(SupabaseConfig.publishableKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if let prefer {
            request.setValue(prefer, forHTTPHeaderField: "Prefer")
        }
    }

    private static func encode(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? value
    }

    private static func roundCoord(_ value: Double) -> Double {
        (value * 100_000).rounded() / 100_000
    }

    private static func iso8601(_ date: Date) -> String {
        ISO8601DateFormatter().string(from: date)
    }

    private static func isExpired(_ value: Any?) -> Bool {
        guard let raw = value as? String, let date = ISO8601DateFormatter().date(from: raw) else {
            return false
        }
        return date < Date()
    }

    private static func encodeJSON(_ result: TourResult) -> Any? {
        guard let data = try? JSONEncoder().encode(result) else { return nil }
        return try? JSONSerialization.jsonObject(with: data)
    }

    private static func encodeJSONArray<T: Encodable>(_ value: [T]) -> Any {
        guard let data = try? JSONEncoder().encode(value),
              let obj = try? JSONSerialization.jsonObject(with: data)
        else { return [] }
        return obj
    }

    private static func decodeTourResult(_ payload: Any) -> TourResult? {
        guard let data = try? JSONSerialization.data(withJSONObject: payload) else { return nil }
        return try? JSONDecoder().decode(TourResult.self, from: data)
    }
}
