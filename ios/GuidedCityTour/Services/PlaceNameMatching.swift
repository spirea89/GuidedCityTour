import Foundation
import CoreLocation

enum PlaceNameMatching {
    /// Small buffer for map/geocoder imprecision (meters).
    static let locationSlackM = 45.0

    static func withinRadius(
        _ coordinate: CLLocationCoordinate2D,
        center: CLLocationCoordinate2D,
        radius: Double
    ) -> Bool {
        Geo.haversineMeters(center, coordinate) <= radius + locationSlackM
    }

    static func normalize(_ name: String) -> String {
        name
            .folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current)
            .lowercased()
            .replacingOccurrences(of: "[^a-z0-9\\s]", with: " ", options: .regularExpression)
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// 0–100; 70+ is a confident match for pinning.
    static func score(_ a: String, _ b: String) -> Int {
        let left = normalize(a)
        let right = normalize(b)
        guard !left.isEmpty, !right.isEmpty else { return 0 }
        if left == right { return 100 }
        if left.contains(right) || right.contains(left) { return 92 }

        let leftTokens = Set(left.split(separator: " ").map(String.init))
        let rightTokens = Set(right.split(separator: " ").map(String.init))
        let shared = leftTokens.intersection(rightTokens).filter { $0.count >= 3 }
        if shared.isEmpty { return 0 }

        let unionCount = leftTokens.union(rightTokens).count
        let ratio = Double(shared.count) / Double(max(unionCount, 1))
        return Int((ratio * 85).rounded())
    }

    static func bestOSMMatch(
        name: String,
        in landmarks: [GameBuilding],
        center: CLLocationCoordinate2D,
        radius: Double
    ) -> GameBuilding? {
        var best: (GameBuilding, Int)?
        for landmark in landmarks {
            guard withinRadius(landmark.coordinate, center: center, radius: radius) else { continue }
            let candidateScore = max(
                score(name, landmark.displayName),
                score(name, landmark.name)
            )
            guard candidateScore >= 70 else { continue }
            if best == nil || candidateScore > best!.1 {
                best = (landmark, candidateScore)
            }
        }
        return best?.0
    }

    static func bestGeocodeHit(
        hits: [PlaceHit],
        expectedName: String,
        center: CLLocationCoordinate2D,
        radius: Double
    ) -> PlaceHit? {
        var best: (PlaceHit, Int)?
        for hit in hits {
            guard withinRadius(hit.coordinate, center: center, radius: radius) else { continue }
            let candidateScore = max(
                score(expectedName, hit.name),
                score(expectedName, hit.displayName)
            )
            guard candidateScore >= 65 else { continue }
            if best == nil || candidateScore > best!.1 {
                best = (hit, candidateScore)
            }
        }
        return best?.0
    }
}
