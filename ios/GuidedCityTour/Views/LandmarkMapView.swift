import SwiftUI
import MapKit

struct LandmarkMapView: View {
    @Environment(AppModel.self) private var app
    @Environment(LocationService.self) private var location

    @State private var camera: MapCameraPosition = .automatic
    @State private var showHistory = false
    @State private var showSettings = false

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottom) {
                Map(position: $camera) {
                    if location.coordinate != nil {
                        UserAnnotation()
                    }
                    ForEach(app.buildings) { building in
                        Marker(
                            building.displayName,
                            systemImage: Self.symbol(for: building.entityType),
                            coordinate: building.coordinate
                        )
                        .tint(building.entityType.gameAccent)
                    }
                }
                .mapStyle(.standard(elevation: .flat))
                .mapControls {
                    MapUserLocationButton()
                    MapCompass()
                }

                if let building = app.selectedBuilding ?? app.buildings.first {
                    resultCard(building)
                        .padding(.horizontal, 14)
                        .padding(.bottom, 12)
                }
            }
            .navigationTitle("Identified place")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        app.resetQuest()
                    } label: {
                        Label("New photo", systemImage: "camera")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showSettings = true
                    } label: {
                        Image(systemName: "gearshape")
                    }
                }
            }
            .sheet(isPresented: $showHistory) {
                if let building = app.selectedBuilding ?? app.buildings.first {
                    BuildingHistoryView(building: building, nearby: app.buildings)
                }
            }
            .sheet(isPresented: $showSettings) {
                SettingsView()
            }
            .onAppear {
                fitPins()
                if app.selectedBuilding != nil || app.buildings.count == 1 {
                    showHistory = true
                }
            }
        }
    }

    private func resultCard(_ building: GameBuilding) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if let photo = app.capturedPhoto {
                Image(uiImage: photo)
                    .resizable()
                    .scaledToFill()
                    .frame(height: 110)
                    .frame(maxWidth: .infinity)
                    .clipped()
                    .clipShape(RoundedRectangle(cornerRadius: 12))
            }
            Text(building.displayName)
                .font(.headline)
            Text(building.typeLabel.capitalized)
                .font(.caption)
                .foregroundStyle(QuestTheme.accent)
            if !building.formattedAddress.isEmpty {
                Label(building.formattedAddress, systemImage: "mappin.and.ellipse")
                    .font(.caption)
                    .foregroundStyle(QuestTheme.muted)
                    .lineLimit(2)
            }
            if !building.whyNotable.isEmpty {
                Text(building.whyNotable)
                    .font(.footnote)
                    .foregroundStyle(QuestTheme.muted)
            }
            Button {
                app.selectedBuilding = building
                showHistory = true
            } label: {
                Text("Hear the story")
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
        }
        .padding(14)
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    private func fitPins() {
        let coords = app.buildings.map(\.coordinate)
        guard let first = coords.first else { return }
        var minLat = first.latitude, maxLat = first.latitude
        var minLng = first.longitude, maxLng = first.longitude
        for c in coords.dropFirst() {
            minLat = min(minLat, c.latitude)
            maxLat = max(maxLat, c.latitude)
            minLng = min(minLng, c.longitude)
            maxLng = max(maxLng, c.longitude)
        }
        if let user = location.coordinate {
            minLat = min(minLat, user.latitude)
            maxLat = max(maxLat, user.latitude)
            minLng = min(minLng, user.longitude)
            maxLng = max(maxLng, user.longitude)
        }
        let center = CLLocationCoordinate2D(
            latitude: (minLat + maxLat) / 2,
            longitude: (minLng + maxLng) / 2
        )
        let latMeters = max((maxLat - minLat) * 111_320 * 1.8, 250)
        let lngMeters = max((maxLng - minLng) * 111_320 * cos(center.latitude * .pi / 180) * 1.8, 250)
        camera = .region(MKCoordinateRegion(center: center, latitudinalMeters: latMeters, longitudinalMeters: lngMeters))
    }

    private static func symbol(for type: EntityType) -> String {
        switch type {
        case .church: return "building.columns.fill"
        case .museum: return "building.columns"
        case .castle: return "house.lodge.fill"
        case .statue: return "star.fill"
        default: return "mappin.circle.fill"
        }
    }
}
