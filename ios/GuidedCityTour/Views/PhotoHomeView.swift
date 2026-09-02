import SwiftUI
import UIKit
import PhotosUI

struct PhotoHomeView: View {
    @Environment(AppModel.self) private var app
    @Environment(LocationService.self) private var location
    @Environment(SettingsStore.self) private var settings

    @State private var pickedItem: PhotosPickerItem?
    @State private var previewImage: UIImage?
    @State private var showCamera = false
    @State private var showSettings = false
    @State private var areaLabel = "Your location"

    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
                Spacer(minLength: 8)

                photoPreview

                Text(AppIdentity.displayName)
                    .font(.largeTitle.weight(.bold))
                    .foregroundStyle(QuestTheme.text)

                Text("Photograph one building or statue. We’ll use your location and the photo to identify that place and tell its history.")
                    .font(.body)
                    .foregroundStyle(QuestTheme.muted)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)

                if let label = locationLabel {
                    Label(label, systemImage: "location.fill")
                        .font(.footnote)
                        .foregroundStyle(QuestTheme.accent)
                }

                Toggle(isOn: Binding(
                    get: { settings.kidsMode },
                    set: { settings.kidsMode = $0 }
                )) {
                    Label("Kids mode", systemImage: "figure.and.child.holdinghands")
                        .font(.subheadline.weight(.semibold))
                }
                .tint(QuestTheme.landmark)
                .padding(.horizontal, 24)

                if app.isLoadingBuildings {
                    ProgressView(app.loadMessage)
                        .tint(QuestTheme.accent)
                        .padding(.top, 8)
                }

                if let err = app.loadError ?? app.searchError {
                    Text(err)
                        .font(.footnote)
                        .foregroundStyle(QuestTheme.error)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 24)
                }

                Spacer()

                VStack(spacing: 12) {
                    Button {
                        showCamera = true
                    } label: {
                        Label("Take photo", systemImage: "camera.fill")
                            .fontWeight(.semibold)
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 6)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(app.isLoadingBuildings)

                    PhotosPicker(selection: $pickedItem, matching: .images) {
                        Label("Choose from library", systemImage: "photo.on.rectangle")
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 6)
                    }
                    .buttonStyle(.bordered)
                    .disabled(app.isLoadingBuildings)

                    if previewImage != nil {
                        Button {
                            Task { await identifyFromPhoto() }
                        } label: {
                            Text("Identify this place")
                                .fontWeight(.semibold)
                                .frame(maxWidth: .infinity)
                                .padding(.vertical, 6)
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(QuestTheme.landmark)
                        .disabled(app.isLoadingBuildings)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.bottom, 24)
            }
            .background(QuestTheme.bgDeep.ignoresSafeArea())
            .navigationTitle("Scan a place")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showSettings = true
                    } label: {
                        Image(systemName: settings.hasConfiguredLLM ? "gearshape.fill" : "gearshape")
                    }
                }
            }
            .sheet(isPresented: $showSettings) {
                SettingsView()
            }
            .fullScreenCover(isPresented: $showCamera) {
                CameraPicker { image in
                    previewImage = preparePhoto(image)
                    Task { await identifyFromPhoto() }
                }
                .ignoresSafeArea()
            }
            .onChange(of: pickedItem) { _, item in
                guard let item else { return }
                Task {
                    if let data = try? await item.loadTransferable(type: Data.self),
                       let image = UIImage(data: data)
                    {
                        previewImage = preparePhoto(image)
                        await identifyFromPhoto()
                    }
                }
            }
            .task {
                location.requestWhenInUse()
                location.start()
                await refreshAreaLabel()
            }
        }
    }

    private var photoPreview: some View {
        Group {
            if let previewImage {
                Image(uiImage: previewImage)
                    .resizable()
                    .scaledToFill()
                    .frame(maxWidth: .infinity)
                    .frame(height: 280)
                    .clipped()
                    .overlay(alignment: .bottom) {
                        LinearGradient(
                            colors: [.clear, QuestTheme.bgDeep.opacity(0.85)],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                        .frame(height: 80)
                    }
            } else {
                ZStack {
                    Rectangle()
                        .fill(QuestTheme.bgPanel)
                    VStack(spacing: 10) {
                        Image(systemName: "building.columns")
                            .font(.system(size: 44))
                            .foregroundStyle(QuestTheme.accent)
                        Text("Point the camera at one landmark")
                            .font(.subheadline)
                            .foregroundStyle(QuestTheme.muted)
                    }
                }
                .frame(height: 280)
            }
        }
    }

    private var locationLabel: String? {
        if !areaLabel.isEmpty { return areaLabel }
        if let coord = location.coordinate {
            return String(format: "%.5f, %.5f", coord.latitude, coord.longitude)
        }
        return nil
    }

    private func refreshAreaLabel() async {
        guard let coord = location.coordinate else { return }
        if let reverse = try? await GeocoderService.reverse(coordinate: coord) {
            if !reverse.city.isEmpty {
                areaLabel = reverse.city
            } else if !reverse.displayName.isEmpty {
                areaLabel = reverse.displayName
            }
        }
    }

    private func identifyFromPhoto() async {
        guard let previewImage else { return }
        guard settings.hasConfiguredLLM else {
            app.searchError = "Configure AI in Settings first."
            showSettings = true
            return
        }
        guard let coord = location.coordinate else {
            app.searchError = "Location is required. Allow location access and try again."
            location.requestWhenInUse()
            location.refreshOnce()
            return
        }

        app.isLoadingBuildings = true
        app.loadError = nil
        app.searchError = nil
        app.loadMessage = "Reading the photo and matching nearby landmarks…"
        defer { app.isLoadingBuildings = false }

        async let reverseLookup = try? GeocoderService.reverse(coordinate: coord)
        async let nearbyLookup = try? OverpassService.shared.fetchNamedLandmarks(
            center: coord,
            radius: 250
        )
        let (reverseResult, nearbyResult) = await (reverseLookup, nearbyLookup)
        let reverse = reverseResult ?? nil
        let nearbyCandidates = nearbyResult ?? []
        if let reverse {
            areaLabel = reverse.displayName
        }
        let label = reverse?.displayName ?? (areaLabel.isEmpty ? "Your location" : areaLabel)

        do {
            let identifier = BuildingPhotoIdentifier(
                client: settings.makeClient(),
                usesLocalLLM: settings.usesLocalLLM
            )
            let building = try await identifier.identify(
                image: previewImage,
                coordinate: coord,
                areaLabel: label,
                locationTags: reverse?.addressTags ?? [:],
                nearbyCandidates: nearbyCandidates
            )
            app.buildings = [building]
            app.selectedBuilding = building
            app.selection = MapSelection(center: building.coordinate, radiusMeters: 120, label: label)
            app.questUserCoordinate = coord
            app.nearbyFromCache = false
            app.capturedPhoto = previewImage
            app.screen = .result
        } catch {
            app.loadError = error.localizedDescription
            app.searchError = error.localizedDescription
        }
    }

    private func preparePhoto(_ image: UIImage) -> UIImage {
        let maxSide: CGFloat = 1600
        let longest = max(image.size.width, image.size.height)
        guard longest > maxSide else { return image }
        let scale = maxSide / longest
        let target = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        return UIGraphicsImageRenderer(size: target).image { _ in
            image.draw(in: CGRect(origin: .zero, size: target))
        }
    }
}

/// UIKit camera wrapper for SwiftUI.
struct CameraPicker: UIViewControllerRepresentable {
    var onImage: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = UIImagePickerController.isSourceTypeAvailable(.camera) ? .camera : .photoLibrary
        picker.delegate = context.coordinator
        picker.allowsEditing = false
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPicker
        init(parent: CameraPicker) { self.parent = parent }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.dismiss()
        }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            if let image = info[.originalImage] as? UIImage {
                parent.onImage(image)
            }
            parent.dismiss()
        }
    }
}
