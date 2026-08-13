import Foundation
import CoreLocation

enum Geo {
    static let earthRadiusM = 6_371_000.0
    static let metersPerDegreeLat = 111_320.0

    static func metersPerDegreeLng(latitude: Double) -> Double {
        metersPerDegreeLat * cos(latitude * .pi / 180)
    }

    static func haversineMeters(
        _ a: CLLocationCoordinate2D,
        _ b: CLLocationCoordinate2D
    ) -> Double {
        let dLat = (b.latitude - a.latitude) * .pi / 180
        let dLng = (b.longitude - a.longitude) * .pi / 180
        let lat1 = a.latitude * .pi / 180
        let lat2 = b.latitude * .pi / 180
        let h =
            sin(dLat / 2) * sin(dLat / 2)
            + cos(lat1) * cos(lat2) * sin(dLng / 2) * sin(dLng / 2)
        return 2 * earthRadiusM * asin(min(1, sqrt(h)))
    }

    /// SceneKit local meters: +X east, +Z south, +Y up.
    static func localPoint(
        lat: Double,
        lng: Double,
        origin: CLLocationCoordinate2D
    ) -> SIMD2<Float> {
        let x = (lng - origin.longitude) * metersPerDegreeLng(latitude: origin.latitude)
        let z = (origin.latitude - lat) * metersPerDegreeLat
        return SIMD2(Float(x), Float(z))
    }

    static func centroid(_ coords: [CLLocationCoordinate2D]) -> CLLocationCoordinate2D {
        guard !coords.isEmpty else {
            return CLLocationCoordinate2D(latitude: 0, longitude: 0)
        }
        let lat = coords.map(\.latitude).reduce(0, +) / Double(coords.count)
        let lng = coords.map(\.longitude).reduce(0, +) / Double(coords.count)
        return CLLocationCoordinate2D(latitude: lat, longitude: lng)
    }

    static func boundingSpan(_ coords: [CLLocationCoordinate2D]) -> (width: Double, depth: Double) {
        guard let first = coords.first else { return (8, 8) }
        var minLat = first.latitude, maxLat = first.latitude
        var minLng = first.longitude, maxLng = first.longitude
        for c in coords.dropFirst() {
            minLat = min(minLat, c.latitude)
            maxLat = max(maxLat, c.latitude)
            minLng = min(minLng, c.longitude)
            maxLng = max(maxLng, c.longitude)
        }
        let origin = CLLocationCoordinate2D(latitude: (minLat + maxLat) / 2, longitude: (minLng + maxLng) / 2)
        let width = abs(maxLng - minLng) * metersPerDegreeLng(latitude: origin.latitude)
        let depth = abs(maxLat - minLat) * metersPerDegreeLat
        return (max(4, width), max(4, depth))
    }
}

enum CoordEqual {
    static func isEqual(_ a: CLLocationCoordinate2D, _ b: CLLocationCoordinate2D) -> Bool {
        abs(a.latitude - b.latitude) < 1e-9 && abs(a.longitude - b.longitude) < 1e-9
    }
}
