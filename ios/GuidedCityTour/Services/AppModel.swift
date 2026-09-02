import Foundation
import Observation
import CoreLocation
import UIKit

enum AppScreen: Hashable {
    case home
    case result
}

@MainActor
@Observable
final class AppModel {
    var screen: AppScreen = .home
    var selection: MapSelection?
    var buildings: [GameBuilding] = []
    var selectedBuilding: GameBuilding?
    var isLoadingBuildings = false
    var loadMessage = ""
    var loadError: String?
    var searchQuery = ""
    var searchError: String?
    var isSearching = false
    var nearbyFromCache = false
    var capturedPhoto: UIImage?

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
        screen = .home
        selectedBuilding = nil
        buildings = []
        questUserCoordinate = nil
        loadError = nil
        loadMessage = ""
        searchError = nil
        nearbyFromCache = false
        capturedPhoto = nil
        selection = nil
    }
}
