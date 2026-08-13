import SwiftUI
import MapKit

struct LandmarkMapView: View {
    @Environment(AppModel.self) private var app
    @Environment(LocationService.self) private var location

    @State private var camera: MapCameraPosition = .automatic
    @State private var selectedId: String?
    @State private var showHistory = false
    @State private var showSettings = false

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottom) {
                Map(position: $camera, selection: $selectedId) {
                    if location.coordinate != nil {
                        UserAnnotation()
                    }
                    if let selection = app.selection {
                        MapCircle(center: selection.center, radius: selection.radiusMeters)
                            .foregroundStyle(QuestTheme.accent.opacity(0.08))
                            .stroke(QuestTheme.accent.opacity(0.45), lineWidth: 1)
                    }
                    ForEach(app.buildings) { building in
                        Marker(
                            building.displayName,
                            systemImage: Self.symbol(for: building.entityType),
                            coordinate: building.coordinate
                        )
                        .tint(building.entityType.gameAccent)
                        .tag(building.id)
                    }
                }
                .mapStyle(.standard(elevation: .flat))
                .mapControls {
                    MapUserLocationButton()
                    MapCompass()
                }

                VStack(spacing: 10) {
                    if let building = app.buildings.first(where: { $0.id == selectedId }) {
                        selectedCard(building)
                    } else {
                        listCard
                    }
                }
                .padding(.horizontal, 14)
                .padding(.bottom, 12)
            }
            .navigationTitle(app.selection?.label ?? "Notable places")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        app.resetQuest()
                    } label: {
                        Label("Area", systemImage: "map")
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
                if let building = app.selectedBuilding {
                    BuildingHistoryView(building: building, nearby: app.buildings)
                }
            }
            .sheet(isPresented: $showSettings) {
                SettingsView()
            }
            .onAppear {
                fitPins()
            }
            .onChange(of: selectedId) { _, newValue in
                guard let newValue,
                      let building = app.buildings.first(where: { $0.id == newValue })
                else { return }
                app.selectedBuilding = building
                showHistory = true
            }
        }
    }

    private var listCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("\(app.buildings.count) notable places")
                .font(.headline)
            Text("Tap a pin to hear its history. The guide picked the most important buildings and monuments in this area.")
                .font(.footnote)
                .foregroundStyle(QuestTheme.muted)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(app.buildings) { building in
                        Button {
                            selectedId = building.id
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(building.displayName)
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(QuestTheme.text)
                                Text(building.typeLabel.capitalized)
                                    .font(.caption2)
                                    .foregroundStyle(QuestTheme.muted)
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 8)
                            .background(QuestTheme.bgDeep.opacity(0.55))
                            .clipShape(RoundedRectangle(cornerRadius: 10))
                        }
                    }
                }
            }
        }
        .padding(14)
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    private func selectedCard(_ building: GameBuilding) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(building.displayName)
                        .font(.headline)
                    Text(building.typeLabel.capitalized)
                        .font(.caption)
                        .foregroundStyle(QuestTheme.accent)
                }
                Spacer()
                Circle()
                    .fill(building.entityType.gameAccent)
                    .frame(width: 12, height: 12)
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
                Text("Start the story")
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
        let latMeters = max((maxLat - minLat) * 111_320 * 1.8, 400)
        let lngMeters = max((maxLng - minLng) * 111_320 * cos(center.latitude * .pi / 180) * 1.8, 400)
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
