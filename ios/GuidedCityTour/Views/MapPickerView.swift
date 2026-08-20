import SwiftUI
import MapKit

struct MapPickerView: View {
    @Environment(AppModel.self) private var app
    @Environment(LocationService.self) private var location
    @Environment(SettingsStore.self) private var settings

    @State private var camera: MapCameraPosition = .automatic
    @State private var showSettings = false

    var body: some View {
        @Bindable var app = app
        NavigationStack {
            ZStack(alignment: .bottom) {
                Map(position: $camera, interactionModes: .all) {
                    if location.coordinate != nil {
                        UserAnnotation()
                    }
                    MapCircle(center: app.pickerCenter, radius: app.pickerRadius)
                        .foregroundStyle(QuestTheme.accent.opacity(0.18))
                        .stroke(QuestTheme.accent.opacity(0.85), lineWidth: 2)
                }
                .mapStyle(.standard(elevation: .flat))
                .onMapCameraChange(frequency: .onEnd) { context in
                    app.pickerCenter = context.camera.centerCoordinate
                }
                .overlay {
                    Image(systemName: "plus")
                        .font(.title2.weight(.semibold))
                        .foregroundStyle(QuestTheme.accent)
                        .shadow(color: .black.opacity(0.45), radius: 3)
                        .allowsHitTesting(false)
                }

                VStack(spacing: 12) {
                    searchBar
                    Spacer()
                    controlCard
                }
                .padding(.horizontal, 16)
                .padding(.top, 8)
                .padding(.bottom, 12)
            }
            .navigationTitle(AppIdentity.displayName)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        showSettings = true
                    } label: {
                        Image(systemName: settings.hasConfiguredLLM ? "key.fill" : "key")
                    }
                }
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        locateMe()
                    } label: {
                        Image(systemName: "location.fill")
                    }
                }
            }
            .sheet(isPresented: $showSettings) {
                SettingsView()
            }
            .task {
                recenterCamera(app.pickerCenter)
            }
        }
    }

    private var searchBar: some View {
        @Bindable var app = app
        return HStack {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(QuestTheme.muted)
            TextField("Search a neighbourhood…", text: $app.searchQuery)
                .textInputAutocapitalization(.never)
                .submitLabel(.search)
                .onSubmit { Task { await runSearch() } }
            if app.isSearching {
                ProgressView()
            }
        }
        .padding(12)
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(QuestTheme.border, lineWidth: 1)
        )
    }

    private var controlCard: some View {
        @Bindable var app = app
        return VStack(alignment: .leading, spacing: 12) {
            Text("Choose an area to explore")
                .font(.headline)
            Text(app.pickerLabel)
                .font(.subheadline)
                .foregroundStyle(QuestTheme.muted)
            Text(String(format: "%.5f, %.5f", app.pickerCenter.latitude, app.pickerCenter.longitude))
                .font(.caption.monospaced())
                .foregroundStyle(QuestTheme.muted)

            HStack {
                Text("Radius \(distanceLabel(app.pickerRadius))")
                    .font(.subheadline)
                Slider(value: $app.pickerRadius, in: 300...1500, step: 50)
            }

            if let err = app.searchError {
                Text(err).font(.footnote).foregroundStyle(QuestTheme.error)
            }
            if let locErr = location.lastError {
                Text(locErr).font(.footnote).foregroundStyle(QuestTheme.error)
            }

            Button {
                Task { await discover() }
            } label: {
                HStack {
                    if app.isLoadingBuildings {
                        ProgressView().tint(QuestTheme.bgDeep)
                    }
                    Text(app.isLoadingBuildings ? app.loadMessage : "Find notable places")
                        .fontWeight(.semibold)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 6)
            }
            .buttonStyle(.borderedProminent)
            .disabled(app.isLoadingBuildings)

            Text("The guide only keeps places that match real OpenStreetMap landmarks and have a verified story. If none qualify in this radius, it will ask you to search wider.")
                .font(.caption)
                .foregroundStyle(QuestTheme.muted)
        }
        .padding(16)
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(QuestTheme.border, lineWidth: 1)
        )
    }

    private func locateMe() {
        location.requestWhenInUse()
        location.refreshOnce()
        if let coord = location.coordinate {
            app.applyUserLocation(coord)
            recenterCamera(coord)
        }
    }

    private func recenterCamera(_ coord: CLLocationCoordinate2D) {
        camera = .region(
            MKCoordinateRegion(
                center: coord,
                latitudinalMeters: max(app.pickerRadius * 4.5, 500),
                longitudinalMeters: max(app.pickerRadius * 4.5, 500)
            )
        )
    }

    private func runSearch() async {
        let q = app.searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !q.isEmpty else { return }
        app.isSearching = true
        app.searchError = nil
        defer { app.isSearching = false }
        do {
            let hits = try await GeocoderService.search(q)
            guard let first = hits.first else {
                app.searchError = "No results found."
                return
            }
            app.pickerCenter = first.coordinate
            app.pickerLabel = first.displayName
            recenterCamera(first.coordinate)
        } catch {
            app.searchError = "Search failed. Try again in a moment."
        }
    }

    private func distanceLabel(_ meters: Double) -> String {
        if meters >= 1000 {
            return String(format: "%.1f km", meters / 1000)
        }
        return "\(Int(meters)) m"
    }

    private func discover() async {
        guard settings.hasConfiguredLLM else {
            app.searchError = settings.usesLocalLLM
                ? "Set Local base URL and model id in Settings (LM Studio server must be running)."
                : "Add an OpenAI API key in Settings so the guide can pick the important buildings."
            showSettings = true
            return
        }

        app.isLoadingBuildings = true
        app.loadError = nil
        app.searchError = nil
        app.loadMessage = "Naming this neighbourhood…"
        defer { app.isLoadingBuildings = false }

        let center = app.pickerCenter
        let radius = app.pickerRadius
        var label = app.pickerLabel
        if let reverse = try? await GeocoderService.reverse(coordinate: center) {
            label = reverse.displayName
            app.pickerLabel = label
        }

        app.loadMessage = "Finding the important buildings…"
        do {
            let service = LandmarkDiscoveryService(
                client: settings.makeClient(),
                usesLocalLLM: settings.usesLocalLLM,
                kidsMode: settings.kidsMode
            )
            app.loadMessage = "Checking which places have verified stories…"
            let buildings = try await service.discover(
                center: center,
                radius: radius,
                areaLabel: label
            )
            app.buildings = buildings
            app.selection = MapSelection(center: center, radiusMeters: radius, label: label)
            app.questUserCoordinate = location.coordinate
            app.selectedBuilding = nil
            app.screen = .pins
        } catch {
            app.loadError = error.localizedDescription
            app.searchError = error.localizedDescription
        }
    }
}
