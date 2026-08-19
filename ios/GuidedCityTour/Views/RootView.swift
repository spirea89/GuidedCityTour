import SwiftUI
import MapKit

struct RootView: View {
    @Environment(AppModel.self) private var app
    @Environment(SettingsStore.self) private var settings
    @Environment(LocationService.self) private var location

    var body: some View {
        Group {
            if !settings.hasCompletedOnboarding {
                OnboardingView()
            } else {
                switch app.screen {
                case .map:
                    MapPickerView()
                case .pins:
                    LandmarkMapView()
                }
            }
        }
        .background(QuestTheme.bgDeep.ignoresSafeArea())
        .onAppear {
            if location.authorization == .notDetermined {
                location.requestWhenInUse()
            } else if location.authorization == .authorizedWhenInUse || location.authorization == .authorizedAlways {
                location.start()
            }
        }
        .onChange(of: location.coordinate?.latitude) { _, _ in
            guard let coord = location.coordinate else { return }
            if !app.didAutoCenterOnUser, app.screen == .map {
                app.didAutoCenterOnUser = true
                app.applyUserLocation(coord)
                Task { await app.loadNearbyFromCache(coordinate: coord) }
            }
        }
    }
}
