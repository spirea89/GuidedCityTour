import Foundation
import CoreLocation

enum OverpassError: LocalizedError {
    case empty
    case http(Int)
    case decode
    case cancelled

    var errorDescription: String? {
        switch self {
        case .empty: return "No buildings found in this area."
        case .http(let code): return "Map data request failed (\(code))."
        case .decode: return "Could not read OpenStreetMap building data."
        case .cancelled: return "Cancelled"
        }
    }
}

struct OverpassService: Sendable {
    static let shared = OverpassService()

    private let endpoints = [
        "https://overpass.kumi.systems/api/interpreter",
        "https://overpass-api.de/api/interpreter",
        "https://overpass.private.coffee/api/interpreter"
    ]

    private let userAgent = "GuidedCityTour-iOS/3.0 (https://github.com/spirea89/GuidedCityTour)"
    private let maxBuildings = 48

    func fetchWorld(
        center: CLLocationCoordinate2D,
        radius: Double
    ) async throws -> [GameBuilding] {
        try await Task.detached(priority: .userInitiated) { [self] in
            try await self.fetchAndNormalize(center: center, radius: radius)
        }.value
    }

    /// Named tourism / historic / worship POIs with OSM center coordinates (for pin placement).
    func fetchNamedLandmarks(
        center: CLLocationCoordinate2D,
        radius: Double
    ) async throws -> [GameBuilding] {
        try await Task.detached(priority: .userInitiated) { [self] in
            let query = Self.namedLandmarkQuery(
                lat: center.latitude,
                lng: center.longitude,
                radius: radius
            )
            var lastError: Error = OverpassError.empty
            for endpoint in endpoints {
                if Task.isCancelled { throw OverpassError.cancelled }
                do {
                    let elements = try await fetchElements(endpoint: endpoint, query: query)
                    let landmarks = normalizeLandmarks(
                        elements: elements,
                        center: center,
                        radius: radius
                    )
                    if !landmarks.isEmpty { return landmarks }
                    lastError = OverpassError.empty
                } catch is CancellationError {
                    throw OverpassError.cancelled
                } catch {
                    lastError = error
                }
            }
            throw lastError
        }.value
    }

    private func fetchAndNormalize(
        center: CLLocationCoordinate2D,
        radius: Double
    ) async throws -> [GameBuilding] {
        let query = Self.buildQuery(lat: center.latitude, lng: center.longitude, radius: radius)
        var lastError: Error = OverpassError.empty

        for endpoint in endpoints {
            if Task.isCancelled { throw OverpassError.cancelled }
            do {
                let elements = try await fetchElements(endpoint: endpoint, query: query)
                let buildings = normalize(elements: elements, center: center, radius: radius)
                if !buildings.isEmpty { return buildings }
                lastError = OverpassError.empty
            } catch is CancellationError {
                throw OverpassError.cancelled
            } catch {
                lastError = error
            }
        }
        throw lastError
    }

    private func fetchElements(endpoint: String, query: String) async throws -> [OverpassElement] {
        guard var comps = URLComponents(string: endpoint) else { throw OverpassError.http(0) }
        comps.queryItems = [URLQueryItem(name: "data", value: query)]
        guard let url = comps.url else { throw OverpassError.http(0) }

        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
        request.timeoutInterval = 16

        let (data, response) = try await URLSession.shared.data(for: request)
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else { throw OverpassError.http(code) }

        let decoded: OverpassResponse
        do {
            decoded = try JSONDecoder().decode(OverpassResponse.self, from: data)
        } catch {
            throw OverpassError.decode
        }
        return decoded.elements
    }

    private func normalize(
        elements: [OverpassElement],
        center: CLLocationCoordinate2D,
        radius: Double
    ) -> [GameBuilding] {
        var byId: [String: GameBuilding] = [:]

        for el in elements {
            let tags = el.tags ?? [:]
            guard let coord = el.centerCoordinate else { continue }

            let dist = Geo.haversineMeters(center, coord)
            if dist > radius + 8 { continue }

            let entity = EntityTyping.infer(from: tags)
            let rawName = (tags["name"] ?? tags["name:en"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let isLM = EntityTyping.isLandmarkTags(tags) && rawName.count >= 2
            let id = "\(el.type ?? "way")/\(el.id ?? 0)"
            let size = Self.sketchSize(id: id, entity: entity, isLandmark: isLM)

            let building = GameBuilding(
                id: id,
                name: rawName,
                entityType: entity == .unknown ? .building : entity,
                coordinate: coord,
                heightMeters: BuildingHeight.estimate(tags: tags, entityType: entity),
                widthMeters: size.width,
                depthMeters: size.depth,
                tags: tags,
                isLandmark: isLM,
                typeLabel: EntityTyping.typeLabel(from: tags),
                whyNotable: "",
                osmId: el.id,
                osmType: el.type
            )

            if let existing = byId[id] {
                if building.hasProperName && !existing.hasProperName {
                    byId[id] = building
                }
            } else {
                byId[id] = building
            }
        }

        let all = Array(byId.values)
        let named = all.filter(\.hasProperName).sorted {
            if $0.isLandmark != $1.isLandmark { return $0.isLandmark && !$1.isLandmark }
            return Geo.haversineMeters(center, $0.coordinate) < Geo.haversineMeters(center, $1.coordinate)
        }
        let unnamed = all.filter { !$0.hasProperName }.sorted {
            Geo.haversineMeters(center, $0.coordinate) < Geo.haversineMeters(center, $1.coordinate)
        }

        var picked: [GameBuilding] = []
        picked.append(contentsOf: named.prefix(18))
        let remaining = maxBuildings - picked.count
        if remaining > 0 {
            picked.append(contentsOf: unnamed.prefix(remaining))
        }
        return picked
    }

    private func normalizeLandmarks(
        elements: [OverpassElement],
        center: CLLocationCoordinate2D,
        radius: Double
    ) -> [GameBuilding] {
        var byId: [String: GameBuilding] = [:]

        for el in elements {
            let tags = el.tags ?? [:]
            let rawName = (tags["name"] ?? tags["name:en"] ?? "")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard rawName.count >= 2, let coord = el.centerCoordinate else { continue }

            if Geo.haversineMeters(center, coord) > radius + PlaceNameMatching.locationSlackM {
                continue
            }

            let entity = EntityTyping.infer(from: tags)
            let id = "\(el.type ?? "way")/\(el.id ?? 0)"
            let building = GameBuilding(
                id: id,
                name: rawName,
                entityType: entity == .unknown ? .landmark : entity,
                coordinate: coord,
                heightMeters: BuildingHeight.estimate(tags: tags, entityType: entity),
                widthMeters: 12,
                depthMeters: 12,
                tags: tags,
                isLandmark: true,
                typeLabel: EntityTyping.typeLabel(from: tags),
                whyNotable: "",
                osmId: el.id,
                osmType: el.type
            )
            byId[id] = building
        }

        return Array(byId.values).sorted {
            Geo.haversineMeters(center, $0.coordinate) < Geo.haversineMeters(center, $1.coordinate)
        }
    }

    private static func namedLandmarkQuery(lat: Double, lng: Double, radius: Double) -> String {
        let r = Int(min(max(radius, 80), 1200).rounded())
        return """
        [out:json][timeout:14];
        (
          nwr["name"]["tourism"](around:\(r),\(lat),\(lng));
          nwr["name"]["historic"](around:\(r),\(lat),\(lng));
          nwr["name"]["amenity"~"^(museum|theatre|place_of_worship|arts_centre)$"](around:\(r),\(lat),\(lng));
          nwr["name"]["building"~"^(cathedral|church|chapel|mosque|synagogue|temple|castle|palace)$"](around:\(r),\(lat),\(lng));
          nwr["name"]["leisure"~"^(stadium|park|garden)$"](around:\(r),\(lat),\(lng));
        );
        out center tags 120;
        """
    }

    private static func sketchSize(id: String, entity: EntityType, isLandmark: Bool) -> (width: Double, depth: Double) {
        switch entity {
        case .church: return (14, 12)
        case .castle: return (18, 16)
        case .museum, .landmark: return (15, 12)
        case .statue: return (5, 5)
        default:
            let hash = abs(id.hashValue)
            let extra: Double = isLandmark ? 4 : 0
            return (7 + extra + Double(hash % 8), 6 + extra + Double((hash >> 5) % 8))
        }
    }

    /// Centers + tags only (no full way geometry) so the payload stays small.
    private static func buildQuery(lat: Double, lng: Double, radius: Double) -> String {
        let r = Int(min(max(radius, 60), 280).rounded())
        return """
        [out:json][timeout:12];
        (
          way["building"](around:\(r),\(lat),\(lng));
          nwr["name"]["tourism"](around:\(r),\(lat),\(lng));
          nwr["name"]["historic"](around:\(r),\(lat),\(lng));
          nwr["name"]["amenity"~"^(theatre|place_of_worship|museum|arts_centre)$"](around:\(r),\(lat),\(lng));
        );
        out center tags 70;
        """
    }
}

private struct OverpassResponse: Decodable {
    let elements: [OverpassElement]
}

private struct OverpassElement: Decodable {
    let type: String?
    let id: Int64?
    let lat: Double?
    let lon: Double?
    let tags: [String: String]?
    let center: OverpassCenter?

    var centerCoordinate: CLLocationCoordinate2D? {
        if let c = center { return CLLocationCoordinate2D(latitude: c.lat, longitude: c.lon) }
        if let lat, let lon { return CLLocationCoordinate2D(latitude: lat, longitude: lon) }
        return nil
    }
}

private struct OverpassCenter: Decodable {
    let lat: Double
    let lon: Double
}
