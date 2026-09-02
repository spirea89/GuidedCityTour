import Foundation
import CoreLocation
import Observation

@MainActor
@Observable
final class LocationService: NSObject {
    var authorization: CLAuthorizationStatus = .notDetermined
    var coordinate: CLLocationCoordinate2D?
    var lastError: String?
    var isLocating = false

    private let manager = CLLocationManager()
    private let moveThresholdMeters: CLLocationDistance = 18

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
        manager.distanceFilter = moveThresholdMeters
        manager.pausesLocationUpdatesAutomatically = true
        authorization = manager.authorizationStatus
    }

    func requestWhenInUse() {
        manager.requestWhenInUseAuthorization()
    }

    func start() {
        isLocating = true
        lastError = nil
        manager.startUpdatingLocation()
    }

    func stop() {
        manager.stopUpdatingLocation()
        isLocating = false
    }

    func refreshOnce() {
        isLocating = true
        lastError = nil
        manager.requestLocation()
    }
}

extension LocationService: CLLocationManagerDelegate {
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        authorization = manager.authorizationStatus
        switch authorization {
        case .authorizedAlways, .authorizedWhenInUse:
            start()
        case .denied, .restricted:
            lastError = "Location permission denied. Pick an area on the map instead."
            isLocating = false
        default:
            break
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        if let current = coordinate {
            let previous = CLLocation(latitude: current.latitude, longitude: current.longitude)
            if loc.distance(from: previous) < moveThresholdMeters {
                if isLocating { isLocating = false }
                return
            }
        }
        coordinate = loc.coordinate
        if isLocating { isLocating = false }
        if lastError != nil { lastError = nil }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        isLocating = false
        lastError = error.localizedDescription
    }
}
