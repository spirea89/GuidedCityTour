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

struct OverpassService {
    static let shared = OverpassService()

    private let endpoints = [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
        "https://overpass.private.coffee/api/interpreter"
    ]

    private let userAgent = "GuidedCityTour-iOS/3.0 (https://github.com/spirea89/GuidedCityTour)"
    private let maxBuildings = 90

    func fetchWorld(
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
        request.timeoutInterval = 28

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
            let footprint = el.footprint
            let coord: CLLocationCoordinate2D
            if let c = el.centerCoordinate {
                coord = c
            } else if !footprint.isEmpty {
                coord = Geo.centroid(footprint)
            } else if let lat = el.lat, let lon = el.lon {
                coord = CLLocationCoordinate2D(latitude: lat, longitude: lon)
            } else {
                continue
            }

            let dist = Geo.haversineMeters(center, coord)
            if dist > radius + 8 { continue }

            let entity = EntityTyping.infer(from: tags)
            let isLM = EntityTyping.isLandmarkTags(tags) || entity != .building && entity != .unknown && entity != .place
            let rawName = (tags["name"] ?? tags["name:en"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            let id = "\(el.type ?? "way")/\(el.id ?? 0)"

            let building = GameBuilding(
                id: id,
                name: rawName,
                entityType: entity == .unknown ? .building : entity,
                coordinate: coord,
                heightMeters: BuildingHeight.estimate(tags: tags, entityType: entity),
                footprint: footprint,
                tags: tags,
                isLandmark: isLM && rawName.count >= 2,
                typeLabel: EntityTyping.typeLabel(from: tags),
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
            let d0 = Geo.haversineMeters(center, $0.coordinate)
            let d1 = Geo.haversineMeters(center, $1.coordinate)
            return d0 < d1
        }
        let unnamed = all.filter { !$0.hasProperName }.sorted {
            Geo.haversineMeters(center, $0.coordinate) < Geo.haversineMeters(center, $1.coordinate)
        }

        var picked: [GameBuilding] = []
        picked.append(contentsOf: named.prefix(40))
        let remaining = maxBuildings - picked.count
        if remaining > 0 {
            picked.append(contentsOf: unnamed.prefix(remaining))
        }
        return picked
    }

    private static func buildQuery(lat: Double, lng: Double, radius: Double) -> String {
        let r = Int(min(max(radius, 60), 420).rounded())
        return """
        [out:json][timeout:25];
        (
          way["building"](around:\(r),\(lat),\(lng));
          nwr["name"]["tourism"](around:\(r),\(lat),\(lng));
          nwr["name"]["historic"](around:\(r),\(lat),\(lng));
          nwr["name"]["amenity"~"^(theatre|place_of_worship|museum|arts_centre)$"](around:\(r),\(lat),\(lng));
          nwr["name"]["leisure"~"^(stadium|sports_centre|park|garden)$"](around:\(r),\(lat),\(lng));
          nwr["name"]["building"~"^(church|cathedral|chapel|castle|mosque|synagogue|temple|stadium)$"](around:\(r),\(lat),\(lng));
          nwr["name"]["man_made"~"^(monument|statue|tower)$"](around:\(r),\(lat),\(lng));
        );
        out body geom tags center;
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
    let geometry: [OverpassPoint]?

    var centerCoordinate: CLLocationCoordinate2D? {
        if let c = center { return CLLocationCoordinate2D(latitude: c.lat, longitude: c.lon) }
        if let lat, let lon { return CLLocationCoordinate2D(latitude: lat, longitude: lon) }
        return nil
    }

    var footprint: [CLLocationCoordinate2D] {
        (geometry ?? []).compactMap {
            CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lon)
        }
    }
}

private struct OverpassCenter: Decodable {
    let lat: Double
    let lon: Double
}

private struct OverpassPoint: Decodable {
    let lat: Double
    let lon: Double
}
