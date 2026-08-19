import Foundation
import Observation
import CoreLocation

enum AppScreen: Hashable {
    case map
    case pins
}

@MainActor
@Observable
final class AppModel {
    var screen: AppScreen = .map
    var selection: MapSelection?
    var buildings: [GameBuilding] = []
    var selectedBuilding: GameBuilding?
    var isLoadingBuildings = false
    var loadMessage = ""
    var loadError: String?
    var searchQuery = ""
    var searchError: String?
    var isSearching = false

    /// Set when nearby cached buildings were loaded automatically on location fix.
    var nearbyFromCache = false
    /// Set while the background nearby-cache lookup is running.
    var isLoadingNearby = false

    let defaultCenter = CLLocationCoordinate2D(latitude: 48.8566, longitude: 2.3522)
    var pickerCenter = CLLocationCoordinate2D(latitude: 48.8566, longitude: 2.3522)
    var pickerRadius: Double = 700
    var pickerLabel = "Selected area"
    var didAutoCenterOnUser = false
    var questUserCoordinate: CLLocationCoordinate2D?

    var namedBuildings: [GameBuilding] {
        buildings.filter(\.hasProperName)
    }

    var landmarks: [GameBuilding] {
        buildings.filter(\.isLandmark)
    }

    func applyUserLocation(_ coord: CLLocationCoordinate2D) {
        pickerCenter = coord
        pickerLabel = "Your location"
    }

    func resetQuest() {
        screen = .map
        selectedBuilding = nil
        buildings = []
        questUserCoordinate = nil
        loadError = nil
        loadMessage = ""
        nearbyFromCache = false
    }

    /// Silently load nearby cached pins. Transitions to .pins if results found.
    func loadNearbyFromCache(coordinate: CLLocationCoordinate2D) async {
        guard !isLoadingNearby, !isLoadingBuildings else { return }
        isLoadingNearby = true
        defer { isLoadingNearby = false }

        guard let nearby = await SupabaseCacheService.fetchNearbyAreaPlaces(
            near: coordinate,
            radiusMeters: 1200
        ), !nearby.isEmpty else { return }

        guard screen == .map else { return }
        buildings = nearby
        selection = MapSelection(
            center: coordinate,
            radiusMeters: 1200,
            label: "Nearby cached places"
        )
        questUserCoordinate = coordinate
        selectedBuilding = nil
        nearbyFromCache = true
        screen = .pins
    }
}
