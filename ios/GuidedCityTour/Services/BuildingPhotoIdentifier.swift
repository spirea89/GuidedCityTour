import Foundation
import CoreLocation
import UIKit

enum BuildingPhotoIdentifierError: LocalizedError {
    case missingConfig
    case noImage
    case noPlace
    case failed(String)

    var errorDescription: String? {
        switch self {
        case .missingConfig:
            return "Configure an AI provider in Settings before identifying a place from a photo."
        case .noImage:
            return "No photo was provided."
        case .noPlace:
            return "Could not identify a building or statue in this photo for your location. Try a clearer shot or move closer."
        case .failed(let message):
            return message
        }
    }
}

struct BuildingPhotoIdentifier {
    var client: OpenAIClient
    var usesLocalLLM: Bool

    private let nearbyRadius: Double = 250

    func identify(
        image: UIImage,
        coordinate: CLLocationCoordinate2D,
        areaLabel: String,
        locationTags: [String: String] = [:]
    ) async throws -> GameBuilding {
        guard let jpeg = Self.jpegData(from: image) else {
            throw BuildingPhotoIdentifierError.noImage
        }
        let base64 = jpeg.base64EncodedString()

        let osmCandidates = (try? await OverpassService.shared.fetchNamedLandmarks(
            center: coordinate,
            radius: nearbyRadius
        )) ?? []

        let prompt = userPrompt(
            coordinate: coordinate,
            areaLabel: areaLabel,
            candidates: osmCandidates
        )

        let messages: [[String: Any]] = [
            [
                "role": "system",
                "content": Self.instructions
            ],
            [
                "role": "user",
                "content": [
                    ["type": "text", "text": prompt],
                    [
                        "type": "image_url",
                        "image_url": [
                            "url": "data:image/jpeg;base64,\(base64)"
                        ]
                    ]
                ]
            ]
        ]

        let visionClient: OpenAIClient
        if usesLocalLLM {
            visionClient = client
        } else {
            // Prefer a vision-capable OpenAI model for photo ID.
            let visionModel = client.model.contains("gpt-4o") ? client.model : SettingsStore.qualityModel
            visionClient = OpenAIClient(apiKey: client.apiKey, model: visionModel, baseURL: client.baseURL, timeout: client.timeout)
        }

        let result = await visionClient.createChatCompletion(
            messages: messages,
            temperature: 0.1,
            maxTokens: 900,
            forceJSON: true
        )

        let raw: String
        switch result {
        case .success(let text):
            raw = text
        case .failure(let error):
            throw BuildingPhotoIdentifierError.failed(error.localizedDescription)
        }

        guard let draft = Self.parseDraft(raw) else {
            throw BuildingPhotoIdentifierError.noPlace
        }

        if let osmId = draft.osmId,
           let osm = osmCandidates.first(where: { $0.id == osmId })
        {
            return refine(osm: osm, draft: draft, areaLabel: areaLabel, locationTags: locationTags)
        }

        if let matched = PlaceNameMatching.bestOSMMatch(
            name: draft.name,
            in: osmCandidates,
            center: coordinate,
            radius: nearbyRadius
        ) {
            return refine(osm: matched, draft: draft, areaLabel: areaLabel, locationTags: locationTags)
        }

        guard draft.confidence >= 0.65 else {
            throw BuildingPhotoIdentifierError.noPlace
        }

        // Fall back to the user's GPS for an unnamed/unmatched landmark in the photo.
        let entity = Self.entity(from: draft.type)
        var tags: [String: String] = [
            "name": draft.name,
            "discovery": "photo"
        ]
        tags.merge(locationTags) { current, _ in current }
        if tags["addr:city"] == nil, !areaLabel.isEmpty {
            tags["addr:city"] = areaLabel
        }
        if !draft.address.isEmpty { tags["address"] = draft.address }
        return GameBuilding(
            id: "photo-\(UUID().uuidString.prefix(8))",
            name: draft.name,
            entityType: entity,
            coordinate: coordinate,
            heightMeters: 16,
            widthMeters: 12,
            depthMeters: 12,
            tags: tags,
            isLandmark: true,
            typeLabel: draft.type.isEmpty ? entity.displayLabel.lowercased() : draft.type,
            whyNotable: draft.whyNotable,
            osmId: nil,
            osmType: nil
        )
    }

    private func refine(
        osm: GameBuilding,
        draft: DraftPlace,
        areaLabel: String,
        locationTags: [String: String]
    ) -> GameBuilding {
        var tags = osm.tags
        tags.merge(locationTags) { osmValue, _ in osmValue }
        tags["name"] = osm.name
        tags["discovery"] = "photo+osm"
        if tags["addr:city"] == nil, !areaLabel.isEmpty {
            tags["addr:city"] = areaLabel
        }
        if !draft.address.isEmpty { tags["address"] = draft.address }
        let entity = Self.entity(from: draft.type)
        return GameBuilding(
            id: osm.id,
            name: osm.name.isEmpty ? draft.name : osm.name,
            entityType: osm.entityType == .unknown ? entity : osm.entityType,
            coordinate: osm.coordinate,
            heightMeters: osm.heightMeters,
            widthMeters: osm.widthMeters,
            depthMeters: osm.depthMeters,
            tags: tags,
            isLandmark: true,
            typeLabel: draft.type.isEmpty ? osm.typeLabel : draft.type,
            whyNotable: draft.whyNotable.isEmpty ? osm.whyNotable : draft.whyNotable,
            osmId: osm.osmId,
            osmType: osm.osmType
        )
    }

    private func userPrompt(
        coordinate: CLLocationCoordinate2D,
        areaLabel: String,
        candidates: [GameBuilding]
    ) -> String {
        let candidateList: String
        if candidates.isEmpty {
            candidateList = "(No OpenStreetMap candidates within \(Int(nearbyRadius)) m — identify from the photo + address only.)"
        } else {
            candidateList = candidates.prefix(20).map { building in
                let dist = Int(Geo.haversineMeters(coordinate, building.coordinate).rounded())
                return "- id: \(building.id)\n  name: \(building.displayName)\n  type: \(building.typeLabel)\n  distance_m: \(dist)"
            }.joined(separator: "\n")
        }

        return """
        Identify the SINGLE building, monument, statue, or church shown in the photo.

        Photographer location:
        - Approximate address / area: \(areaLabel.isEmpty ? "Unknown" : areaLabel)
        - Coordinates: \(String(format: "%.5f", coordinate.latitude)), \(String(format: "%.5f", coordinate.longitude))
        - Search radius for OSM candidates: \(Int(nearbyRadius)) meters

        Prefer matching one of these nearby OpenStreetMap candidates when the photo clearly matches:
        \(candidateList)

        Rules:
        1. Return exactly ONE place — the subject of the photo.
        2. Prefer an OSM candidate id when confident.
        3. The place must make sense for this city/address. Do not pick a same-named building in another city.
        4. If unsure, still return the best local guess with a lower confidence.

        JSON only:
        {"id":"osm-id-or-empty","name":"","address":"","type":"church|museum|monument|palace|statue|landmark|building","why_notable":"one sentence","confidence":0.0}
        """
    }

    private static let instructions = """
    You identify landmarks from a tourist photo using the image and the photographer's GPS/address.
    Return a single JSON object. Prefer matching a provided OpenStreetMap candidate id when possible.
    Never invent a famous building from another city that merely looks similar.
    """

    private struct DraftPlace {
        var osmId: String?
        var name: String
        var address: String
        var type: String
        var whyNotable: String
        var confidence: Double
    }

    private static func parseDraft(_ raw: String) -> DraftPlace? {
        let jsonText = extractJSON(raw)
        guard let data = jsonText.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }

        let name = (obj["name"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard name.count >= 2 else { return nil }
        let id = (obj["id"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return DraftPlace(
            osmId: id.count >= 2 ? id : nil,
            name: name,
            address: (obj["address"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines),
            type: (obj["type"] as? String ?? "landmark").lowercased(),
            whyNotable: (obj["why_notable"] as? String ?? obj["whyNotable"] as? String ?? "")
                .trimmingCharacters(in: .whitespacesAndNewlines),
            confidence: (obj["confidence"] as? Double) ?? 0.5
        )
    }

    private static func extractJSON(_ raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasPrefix("{") { return trimmed }
        if let start = trimmed.firstIndex(of: "{"), let end = trimmed.lastIndex(of: "}") {
            return String(trimmed[start...end])
        }
        return trimmed
    }

    private static func jpegData(from image: UIImage) -> Data? {
        let maxSide: CGFloat = 1280
        let size = image.size
        let scale = min(1, maxSide / max(size.width, size.height))
        let target = CGSize(width: size.width * scale, height: size.height * scale)
        let renderer = UIGraphicsImageRenderer(size: target)
        let resized = renderer.image { _ in
            image.draw(in: CGRect(origin: .zero, size: target))
        }
        return resized.jpegData(compressionQuality: 0.72)
    }

    private static func entity(from type: String) -> EntityType {
        let t = type.lowercased()
        if t.contains("church") || t.contains("cathedral") || t.contains("mosque") || t.contains("temple") {
            return .church
        }
        if t.contains("museum") || t.contains("gallery") { return .museum }
        if t.contains("castle") || t.contains("palace") || t.contains("fort") { return .castle }
        if t.contains("statue") || t.contains("monument") || t.contains("memorial") { return .statue }
        return .landmark
    }
}
