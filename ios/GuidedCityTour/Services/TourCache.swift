import Foundation

enum TourCache {
    private static var directory: URL {
        let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first!
        let dir = base.appendingPathComponent("gct_tours", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    /// Shared cache key (matches web `buildCacheKey` in js/services/CacheService.js).
    static func key(building: GameBuilding, kids: Bool, model: String) -> String {
        let lat = String(format: "%.5f", building.coordinate.latitude)
        let lng = String(format: "%.5f", building.coordinate.longitude)
        let nameSlug = building.displayName.lowercased()
            .replacingOccurrences(of: "[^a-z0-9]+", with: "-", options: .regularExpression)
            .prefix(48)
        let presentation = "adult-and-kids"
        let cats = "history"
        let focus = building.isLandmark ? "landmark" : "house"
        let version = AppIdentity.pipelineVersion

        if let osmId = building.osmId {
            let placeId = "\(building.osmType ?? "way")/\(osmId)"
            return "gct:v\(version):id:\(placeId):\(focus):\(cats):\(presentation)"
        }
        if !nameSlug.isEmpty {
            return "gct:v\(version):\(lat):\(lng):\(nameSlug):\(focus):\(cats):\(presentation)"
        }
        return "gct:v\(version):\(lat):\(lng):\(focus):\(cats):\(presentation)"
    }

    static func get(_ key: String) -> TourResult? {
        if let local = getLocal(key) { return local }
        return nil
    }

    static func getLocal(_ key: String) -> TourResult? {
        let url = directory.appendingPathComponent(safe(key))
        guard let data = try? Data(contentsOf: url) else { return nil }
        guard let result = try? JSONDecoder().decode(TourResult.self, from: data) else { return nil }
        return result.status == .ok ? result : nil
    }

    static func set(_ key: String, _ result: TourResult) {
        guard result.status == .ok, !result.claims.verified.isEmpty else { return }
        let url = directory.appendingPathComponent(safe(key))
        if let data = try? JSONEncoder().encode(result) {
            try? data.write(to: url, options: .atomic)
        }
    }

    private static func safe(_ key: String) -> String {
        let trimmed = key.replacingOccurrences(of: "/", with: "_")
        return String(trimmed.prefix(180)) + ".json"
    }
}
