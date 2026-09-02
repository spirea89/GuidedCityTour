import Foundation
import CoreLocation

enum TourStatus: String, Codable, Sendable {
    case ok
    case needsConfirmation = "needs_confirmation"
    case unidentified
    case noHistory = "no_history"
    case sourceConflict = "source_conflict"
    case ambiguousName = "ambiguous_name"
    case offline
    case webSearchUnavailable = "web_search_unavailable"
    case error
}

struct PlaceCandidate: Codable, Hashable, Sendable {
    var name: String
    var entityType: String
    var confidence: Double
    var reason: String

    enum CodingKeys: String, CodingKey {
        case name
        case entityType = "entity_type"
        case confidence
        case reason
    }
}

struct NearbyPlace: Codable, Hashable, Sendable {
    var name: String
    var distM: Int
    var type: String

    enum CodingKeys: String, CodingKey {
        case name
        case distM = "dist_m"
        case type
    }
}

struct IdentifiedPlace: Codable, Sendable {
    var id: String
    var name: String
    var entityType: String
    var lat: Double
    var lng: Double
    var address: [String: String]
    var displayName: String
    var identificationConfidence: Double
    var candidates: [PlaceCandidate]
    var nearbyAllowList: [NearbyPlace]
    var focusKind: String
    var focusLabel: String

    enum CodingKeys: String, CodingKey {
        case id, name, lat, lng, address, candidates
        case entityType = "entity_type"
        case displayName = "display_name"
        case identificationConfidence = "identification_confidence"
        case nearbyAllowList = "nearby_allow_list"
        case focusKind = "focus_kind"
        case focusLabel = "focus_label"
    }
}

struct ClaimSource: Codable, Hashable, Identifiable, Sendable {
    var title: String
    var url: String
    var publisher: String
    var tier: String

    var id: String { url.isEmpty ? title : url }
}

struct FactClaim: Codable, Hashable, Identifiable, Sendable {
    var text: String
    var category: String
    var confidence: Double
    var sources: [ClaimSource]

    var id: String { text }
}

struct TourClaims: Codable, Sendable {
    var verified: [FactClaim]
    var uncertain: [FactClaim]
    var legends: [FactClaim]
    var unknown: [String]

    static let empty = TourClaims(verified: [], uncertain: [], legends: [], unknown: [])
}

struct TourNarration: Codable, Sendable {
    var adult: String
    var kids: String
    var sections: [String: String]

    static let empty = TourNarration(adult: "", kids: "", sections: [:])
}

struct TourResult: Codable, Sendable {
    var status: TourStatus
    var message: String
    var place: IdentifiedPlace?
    var claims: TourClaims
    var narration: TourNarration
    var citations: [ClaimSource]
    var errors: [String]
    var cached: Bool
    var researchAvailable: Bool
    var generatedAt: String

    var speakText: String {
        let kids = narration.kids.trimmingCharacters(in: .whitespacesAndNewlines)
        if !kids.isEmpty { return kids }
        if !narration.adult.isEmpty { return narration.adult }
        let ordered = ["history", "architecture", "famous_people", "interesting_facts", "today"]
        return ordered.compactMap { narration.sections[$0] }.filter { !$0.isEmpty }.joined(separator: "\n\n")
    }

    static func error(_ message: String, place: IdentifiedPlace? = nil) -> TourResult {
        TourResult(
            status: .error,
            message: message,
            place: place,
            claims: .empty,
            narration: .empty,
            citations: [],
            errors: [message],
            cached: false,
            researchAvailable: false,
            generatedAt: ISO8601DateFormatter().string(from: Date())
        )
    }
}

struct MapSelection {
    var center: CLLocationCoordinate2D
    var radiusMeters: Double
    var label: String
}
