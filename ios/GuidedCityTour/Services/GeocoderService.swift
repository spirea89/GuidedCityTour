import Foundation
import CoreLocation

struct PlaceHit {
    let name: String
    let displayName: String
    let coordinate: CLLocationCoordinate2D
    let city: String
}

enum GeocoderService {
    private static let photon = "https://photon.komoot.io/api/"
    private static let reverse = "https://photon.komoot.io/reverse"

    static func search(_ query: String) async throws -> [PlaceHit] {
        let q = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return [] }
        var comps = URLComponents(string: photon)!
        comps.queryItems = [
            URLQueryItem(name: "q", value: q),
            URLQueryItem(name: "limit", value: "6"),
            URLQueryItem(name: "lang", value: "en")
        ]
        let features = try await fetchFeatures(comps.url!)
        return features.compactMap(hit(from:))
    }

    static func reverse(coordinate: CLLocationCoordinate2D) async throws -> PlaceHit? {
        var comps = URLComponents(string: reverse)!
        comps.queryItems = [
            URLQueryItem(name: "lat", value: String(coordinate.latitude)),
            URLQueryItem(name: "lon", value: String(coordinate.longitude)),
            URLQueryItem(name: "lang", value: "en")
        ]
        let features = try await fetchFeatures(comps.url!)
        return features.compactMap(hit(from:)).first
    }

    private static func fetchFeatures(_ url: URL) async throws -> [PhotonFeature] {
        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(
            "GuidedCityTour-iOS/3.0 (https://github.com/spirea89/GuidedCityTour)",
            forHTTPHeaderField: "User-Agent"
        )
        let (data, response) = try await URLSession.shared.data(for: request)
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else {
            throw URLError(.badServerResponse)
        }
        let decoded = try JSONDecoder().decode(PhotonCollection.self, from: data)
        return decoded.features
    }

    private static func hit(from feature: PhotonFeature) -> PlaceHit? {
        guard let coords = feature.geometry?.coordinates, coords.count >= 2 else { return nil }
        let lng = coords[0]
        let lat = coords[1]
        let props = feature.properties
        let name = props?.name ?? props?.street ?? "Place"
        let parts = [
            props?.name,
            props?.street,
            props?.city ?? props?.town ?? props?.village,
            props?.country
        ].compactMap { $0 }.filter { !$0.isEmpty }
        let display = parts.isEmpty ? name : parts.joined(separator: ", ")
        return PlaceHit(
            name: name,
            displayName: display,
            coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lng),
            city: props?.city ?? props?.town ?? props?.village ?? ""
        )
    }
}

private struct PhotonCollection: Decodable {
    let features: [PhotonFeature]
}

private struct PhotonFeature: Decodable {
    let geometry: PhotonGeometry?
    let properties: PhotonProperties?
}

private struct PhotonGeometry: Decodable {
    let coordinates: [Double]?
}

private struct PhotonProperties: Decodable {
    let name: String?
    let street: String?
    let city: String?
    let town: String?
    let village: String?
    let country: String?
}
