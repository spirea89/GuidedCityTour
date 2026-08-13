import Foundation
import Observation
import CoreLocation

enum AppScreen: Hashable {
    case map
    case quest
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

    let defaultCenter = CLLocationCoordinate2D(latitude: 48.8566, longitude: 2.3522)
    var pickerCenter = CLLocationCoordinate2D(latitude: 48.8566, longitude: 2.3522)
    var pickerRadius: Double = 140
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
    }
}
