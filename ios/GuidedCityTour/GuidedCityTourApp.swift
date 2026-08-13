import SwiftUI

@main
struct GuidedCityTourApp: App {
    @State private var appModel = AppModel()
    @State private var settings = SettingsStore()
    @State private var location = LocationService()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(appModel)
                .environment(settings)
                .environment(location)
                .preferredColorScheme(.dark)
                .tint(QuestTheme.accent)
        }
    }
}
