import Foundation
import CoreLocation
import SwiftUI

enum EntityType: String, Codable, CaseIterable, Sendable {
    case building
    case street
    case neighbourhood
    case museum
    case statue
    case church
    case castle
    case restaurant
    case trail
    case landmark
    case place
    case unknown

    var displayLabel: String {
        switch self {
        case .building: return "Building"
        case .street: return "Street"
        case .neighbourhood: return "Neighbourhood"
        case .museum: return "Museum"
        case .statue: return "Monument"
        case .church: return "Place of worship"
        case .castle: return "Castle"
        case .restaurant: return "Eatery"
        case .trail: return "Trail"
        case .landmark: return "Landmark"
        case .place: return "Place"
        case .unknown: return "Place"
        }
    }

    var gameAccent: Color {
        switch self {
        case .church: return Color(red: 0.95, green: 0.82, blue: 0.38)
        case .castle: return Color(red: 0.72, green: 0.58, blue: 0.86)
        case .museum: return QuestTheme.accent
        case .statue, .landmark: return QuestTheme.landmark
        case .restaurant: return Color(red: 0.95, green: 0.45, blue: 0.42)
        case .trail: return Color(red: 0.45, green: 0.78, blue: 0.48)
        default: return Color(red: 0.42, green: 0.55, blue: 0.72)
        }
    }
}

struct GameBuilding: Identifiable, Hashable {
    let id: String
    let name: String
    let entityType: EntityType
    let coordinate: CLLocationCoordinate2D
    let heightMeters: Double
    let widthMeters: Double
    let depthMeters: Double
    let tags: [String: String]
    let isLandmark: Bool
    let typeLabel: String
    let whyNotable: String
    let osmId: Int64?
    let osmType: String?

    var displayName: String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.count >= 2 { return trimmed }
        return "\(entityType.displayLabel) #\(shortId)"
    }

    var hasProperName: Bool {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count >= 2 else { return false }
        let lower = trimmed.lowercased()
        return lower != "yes" && lower != "no" && lower != "unnamed"
    }

    var shortId: String {
        String(id.suffix(4))
    }

    var wikipedia: String? { tags["wikipedia"] }
    var wikidata: String? { tags["wikidata"] }

    var formattedAddress: String {
        if let address = tags["address"]?.trimmingCharacters(in: .whitespacesAndNewlines),
           !address.isEmpty
        {
            return address
        }
        let street = [tags["addr:street"], tags["addr:housenumber"]]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        return [street, tags["addr:postcode"], tags["addr:city"], tags["addr:country"]]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: ", ")
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }

    static func == (lhs: GameBuilding, rhs: GameBuilding) -> Bool {
        lhs.id == rhs.id
    }
}

enum EntityTyping {
    static func infer(from tags: [String: String], focusKind: String = "") -> EntityType {
        if focusKind == "street" { return .street }
        if focusKind == "area" { return .neighbourhood }

        let tourism = (tags["tourism"] ?? "").lowercased()
        let historic = (tags["historic"] ?? "").lowercased()
        let amenity = (tags["amenity"] ?? "").lowercased()
        let building = (tags["building"] ?? "").lowercased()
        let leisure = (tags["leisure"] ?? "").lowercased()
        let manMade = (tags["man_made"] ?? "").lowercased()

        if tourism == "museum" || amenity == "museum" { return .museum }
        if ["attraction", "viewpoint", "yes"].contains(tourism) { return .landmark }
        if ["monument", "memorial", "wayside_shrine"].contains(historic) || manMade == "statue" {
            return .statue
        }
        if historic == "church"
            || amenity == "place_of_worship"
            || ["church", "cathedral", "chapel", "mosque", "synagogue", "temple"].contains(building)
        {
            return .church
        }
        if historic == "castle" || historic == "fort" || building == "castle" { return .castle }
        if ["restaurant", "cafe", "fast_food", "pub", "bar"].contains(amenity) { return .restaurant }
        if leisure == "track" || leisure == "path" || tourism == "trail" { return .trail }
        if ["stadium", "sports_centre", "park", "garden"].contains(leisure)
            || building == "stadium"
            || focusKind == "landmark"
        {
            return .landmark
        }
        if focusKind == "house" || !building.isEmpty { return .building }
        if focusKind == "place" { return .place }
        return .unknown
    }

    static func isLandmarkTags(_ tags: [String: String]) -> Bool {
        let keys = ["tourism", "historic", "amenity", "leisure", "man_made"]
        if keys.contains(where: { tags[$0]?.isEmpty == false }) { return true }
        let building = (tags["building"] ?? "").lowercased()
        return ["church", "cathedral", "chapel", "castle", "mosque", "synagogue", "temple", "stadium"]
            .contains(building)
    }

    static func typeLabel(from tags: [String: String]) -> String {
        if let v = tags["tourism"], !v.isEmpty { return v.replacingOccurrences(of: "_", with: " ") }
        if let v = tags["historic"], !v.isEmpty { return v.replacingOccurrences(of: "_", with: " ") }
        if let v = tags["amenity"], !v.isEmpty { return v.replacingOccurrences(of: "_", with: " ") }
        if let v = tags["leisure"], !v.isEmpty { return v.replacingOccurrences(of: "_", with: " ") }
        if let v = tags["building"], v != "yes" { return v.replacingOccurrences(of: "_", with: " ") }
        return "building"
    }
}

enum BuildingHeight {
    static func estimate(tags: [String: String], entityType: EntityType) -> Double {
        if let raw = tags["height"] ?? tags["building:height"],
           let meters = parseMeters(raw)
        {
            return min(max(meters, 4), 80)
        }
        if let levelsRaw = tags["building:levels"],
           let levels = Double(levelsRaw.replacingOccurrences(of: ",", with: "."))
        {
            return min(max(levels * 3.2, 5), 80)
        }
        switch entityType {
        case .church: return 22
        case .castle: return 18
        case .museum, .landmark: return 16
        case .statue: return 8
        default: return 10
        }
    }

    private static func parseMeters(_ raw: String) -> Double? {
        let cleaned = raw.lowercased()
            .replacingOccurrences(of: "m", with: "")
            .replacingOccurrences(of: " ", with: "")
            .replacingOccurrences(of: ",", with: ".")
        return Double(cleaned)
    }
}
