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
}

enum CoordEqual {
    static func isEqual(_ a: CLLocationCoordinate2D, _ b: CLLocationCoordinate2D) -> Bool {
        abs(a.latitude - b.latitude) < 1e-9 && abs(a.longitude - b.longitude) < 1e-9
    }
}
