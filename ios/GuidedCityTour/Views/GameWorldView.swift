import SwiftUI
import CoreLocation

struct GameWorldView: View {
    @Environment(AppModel.self) private var app

    @State private var showHistory = false
    @State private var showSettings = false
    @State private var resetToken = 0
    @State private var showLegend = true

    var body: some View {
        ZStack(alignment: .bottom) {
            if let selection = app.selection {
                QuestSceneView(
                    buildings: app.buildings,
                    origin: selection.center,
                    userLocation: app.questUserCoordinate,
                    selectedId: app.selectedBuilding?.id,
                    onSelect: { building in
                        app.selectedBuilding = building
                    },
                    resetToken: resetToken
                )
                .ignoresSafeArea()
            }

            VStack(spacing: 10) {
                topBar
                if showLegend { legend }
                Spacer()
                if let building = app.selectedBuilding {
                    selectedCard(building)
                } else {
                    hintCard
                }
            }
            .padding(.horizontal, 14)
            .padding(.top, 8)
            .padding(.bottom, 16)
        }
        .background(QuestTheme.bgDeep)
        .sheet(isPresented: $showHistory) {
            if let building = app.selectedBuilding {
                BuildingHistoryView(
                    building: building,
                    nearby: app.buildings
                )
            }
        }
        .sheet(isPresented: $showSettings) {
            SettingsView()
        }
    }

    private var topBar: some View {
        HStack {
            Button {
                app.resetQuest()
            } label: {
                Label("Map", systemImage: "map")
                    .font(.subheadline.weight(.semibold))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(.ultraThinMaterial)
                    .clipShape(Capsule())
            }
            Spacer()
            Text(app.selection?.label ?? "Quest district")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(QuestTheme.text)
                .lineLimit(1)
                .padding(.horizontal, 10)
            Spacer()
            Button {
                resetToken += 1
            } label: {
                Image(systemName: "camera.viewfinder")
                    .padding(8)
                    .background(.ultraThinMaterial)
                    .clipShape(Circle())
            }
            Button {
                showSettings = true
            } label: {
                Image(systemName: "gearshape")
                    .padding(8)
                    .background(.ultraThinMaterial)
                    .clipShape(Circle())
            }
        }
        .foregroundStyle(QuestTheme.text)
    }

    private var legend: some View {
        HStack(spacing: 10) {
            legendDot(QuestTheme.youHere, "You")
            legendDot(QuestTheme.landmark, "Landmark")
            legendDot(QuestTheme.gold, "Church")
            legendDot(QuestTheme.accent, "Museum")
            Spacer()
            Button {
                showLegend = false
            } label: {
                Image(systemName: "xmark").font(.caption2)
            }
        }
        .font(.caption2)
        .foregroundStyle(QuestTheme.muted)
        .padding(10)
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    private func legendDot(_ color: Color, _ title: String) -> some View {
        HStack(spacing: 4) {
            Circle().fill(color).frame(width: 8, height: 8)
            Text(title)
        }
    }

    private var hintCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("\(app.buildings.count) sketched buildings")
                .font(.headline)
            Text("\(app.landmarks.count) named landmarks · tap a block for its name and history. Drag to orbit, pinch to zoom.")
                .font(.footnote)
                .foregroundStyle(QuestTheme.muted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }

    private func selectedCard(_ building: GameBuilding) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(building.displayName)
                        .font(.headline)
                    Text(building.typeLabel.capitalized + (building.isLandmark ? " · landmark" : " · sketch"))
                        .font(.caption)
                        .foregroundStyle(QuestTheme.muted)
                }
                Spacer()
                Circle()
                    .fill(building.entityType.gameAccent)
                    .frame(width: 14, height: 14)
            }
            Button {
                showHistory = true
            } label: {
                Text("Discover history")
                    .fontWeight(.semibold)
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
        }
        .padding(14)
        .background(.ultraThinMaterial)
        .clipShape(RoundedRectangle(cornerRadius: 16))
    }
}
