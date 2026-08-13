import Foundation
import SceneKit
import SwiftUI
import UIKit
import CoreLocation

final class QuestSceneController: NSObject {
    let scene = SCNScene()
    private(set) var buildingSignature = ""
    private(set) var selectedId: String?
    private var origin = CLLocationCoordinate2D(latitude: 0, longitude: 0)
    private var userNode: SCNNode?
    private var buildingNodes: [String: SCNNode] = [:]
    private var materialCache: [UInt32: SCNMaterial] = [:]
    private var lastUserPoint: SIMD2<Float>?
    private weak var scnView: SCNView?

    var onSelectBuilding: ((GameBuilding) -> Void)?
    private var buildingsById: [String: GameBuilding] = [:]
    var lastResetToken = 0

    func attach(_ view: SCNView) {
        scnView = view
        view.scene = scene
        view.backgroundColor = UIColor(red: 0.04, green: 0.07, blue: 0.12, alpha: 1)
        view.antialiasingMode = .none
        view.preferredFramesPerSecond = 30
        view.rendersContinuously = false
        view.allowsCameraControl = true
        view.defaultCameraController.interactionMode = .orbitTurntable
        view.defaultCameraController.minimumVerticalAngle = 18
        view.defaultCameraController.maximumVerticalAngle = 80
        view.autoenablesDefaultLighting = false
        view.isPlaying = true

        let tap = UITapGestureRecognizer(target: self, action: #selector(handleTap(_:)))
        tap.cancelsTouchesInView = false
        view.addGestureRecognizer(tap)
    }

    func rebuild(
        buildings: [GameBuilding],
        origin: CLLocationCoordinate2D,
        userLocation: CLLocationCoordinate2D?
    ) {
        scene.rootNode.enumerateChildNodes { node, _ in
            node.removeFromParentNode()
        }
        buildingNodes.removeAll(keepingCapacity: true)
        materialCache.removeAll(keepingCapacity: true)
        buildingsById = Dictionary(uniqueKeysWithValues: buildings.map { ($0.id, $0) })
        buildingSignature = Self.signature(buildings)
        self.origin = origin
        selectedId = nil
        userNode = nil
        lastUserPoint = nil

        addLights()
        addGround(radius: estimatedRadius(buildings, origin: origin))

        for building in buildings {
            let node = makeBuildingNode(building)
            scene.rootNode.addChildNode(node)
            buildingNodes[building.id] = node
        }

        if let userLocation {
            placeUser(at: userLocation)
        }

        resetCamera(animated: false)
    }

    func placeUser(at coordinate: CLLocationCoordinate2D) {
        let p = Geo.localPoint(lat: coordinate.latitude, lng: coordinate.longitude, origin: origin)
        if let last = lastUserPoint, hypot(p.x - last.x, p.y - last.y) < 4 {
            return
        }
        lastUserPoint = p
        if userNode == nil {
            let glow = SCNSphere(radius: 2.2)
            glow.segmentCount = 12
            glow.firstMaterial = emissive(UIColor(red: 0.36, green: 0.55, blue: 0.94, alpha: 1), emission: 0.75)
            let node = SCNNode(geometry: glow)
            node.name = "you-are-here"
            node.castsShadow = false
            scene.rootNode.addChildNode(node)
            userNode = node
        }
        userNode?.position = SCNVector3(p.x, 2.4, p.y)
    }

    func select(buildingId: String?) {
        guard selectedId != buildingId else { return }
        if let previous = selectedId, let node = buildingNodes[previous] {
            node.childNode(withName: "glow", recursively: false)?.removeFromParentNode()
        }
        selectedId = buildingId
        guard let buildingId, let node = buildingNodes[buildingId] else { return }
        let halo = SCNPlane(width: 16, height: 16)
        halo.firstMaterial = emissive(UIColor(red: 0.24, green: 0.95, blue: 0.82, alpha: 0.55), emission: 0.7)
        halo.firstMaterial?.isDoubleSided = true
        let haloNode = SCNNode(geometry: halo)
        haloNode.name = "glow"
        haloNode.eulerAngles.x = -.pi / 2
        haloNode.position.y = 0.08
        haloNode.castsShadow = false
        node.addChildNode(haloNode)
    }

    func resetCamera(animated: Bool) {
        guard let view = scnView else { return }
        let radius = max(48, estimatedRadius(Array(buildingsById.values), origin: origin) * 1.25)
        let camera = SCNCamera()
        camera.fieldOfView = 48
        camera.zFar = 900
        camera.zNear = 1
        camera.wantsHDR = false
        let node = SCNNode()
        node.camera = camera
        node.position = SCNVector3(radius * 0.55, radius * 0.68, radius * 0.85)
        node.look(at: SCNVector3(0, 4, 0))
        if animated {
            SCNTransaction.begin()
            SCNTransaction.animationDuration = 0.4
            view.pointOfView = node
            SCNTransaction.commit()
        } else {
            view.pointOfView = node
        }
    }

    static func signature(_ buildings: [GameBuilding]) -> String {
        buildings.map(\.id).sorted().joined(separator: ",")
    }

    @objc private func handleTap(_ gesture: UITapGestureRecognizer) {
        guard let view = scnView else { return }
        let point = gesture.location(in: view)
        let hits = view.hitTest(point, options: [
            SCNHitTestOption.searchMode: SCNHitTestSearchMode.closest,
            SCNHitTestOption.boundingBoxOnly: true
        ])
        for hit in hits {
            var node: SCNNode? = hit.node
            while let current = node {
                if let id = current.name, let building = buildingsById[id] {
                    select(buildingId: id)
                    onSelectBuilding?(building)
                    return
                }
                node = current.parent
            }
        }
    }

    private func addLights() {
        let ambient = SCNNode()
        ambient.light = SCNLight()
        ambient.light?.type = .ambient
        ambient.light?.color = UIColor(red: 0.28, green: 0.34, blue: 0.44, alpha: 1)
        ambient.light?.intensity = 700
        scene.rootNode.addChildNode(ambient)

        let key = SCNNode()
        key.light = SCNLight()
        key.light?.type = .directional
        key.light?.color = UIColor(red: 1.0, green: 0.94, blue: 0.86, alpha: 1)
        key.light?.intensity = 650
        key.light?.castsShadow = false
        key.eulerAngles = SCNVector3(-0.7, 0.45, 0)
        scene.rootNode.addChildNode(key)
    }

    private func addGround(radius: Float) {
        let size = CGFloat(max(160, min(radius * 2.4, 420)))
        let plane = SCNPlane(width: size, height: size)
        let mat = SCNMaterial()
        mat.diffuse.contents = UIColor(red: 0.09, green: 0.14, blue: 0.20, alpha: 1)
        mat.lightingModel = .constant
        plane.materials = [mat]
        let node = SCNNode(geometry: plane)
        node.eulerAngles.x = -.pi / 2
        node.position.y = -0.04
        node.castsShadow = false
        scene.rootNode.addChildNode(node)
    }

    private func makeBuildingNode(_ building: GameBuilding) -> SCNNode {
        let parent = SCNNode()
        parent.name = building.id
        let p = Geo.localPoint(
            lat: building.coordinate.latitude,
            lng: building.coordinate.longitude,
            origin: origin
        )
        parent.position = SCNVector3(p.x, 0, p.y)

        let height = Float(max(5, min(building.heightMeters, 36)))
        let color = uiColor(for: building)
        let box = SCNBox(
            width: CGFloat(max(5, min(building.widthMeters, 22))),
            height: CGFloat(height),
            length: CGFloat(max(5, min(building.depthMeters, 22))),
            chamferRadius: 0
        )
        box.firstMaterial = buildingMaterial(color)
        let body = SCNNode(geometry: box)
        body.position.y = height / 2
        body.castsShadow = false
        parent.addChildNode(body)

        if building.entityType == .church {
            let spire = SCNCone(topRadius: 0.15, bottomRadius: 2.6, height: CGFloat(height * 0.4))
            spire.radialSegmentCount = 8
            spire.firstMaterial = buildingMaterial(UIColor(red: 0.95, green: 0.82, blue: 0.38, alpha: 1))
            let spireNode = SCNNode(geometry: spire)
            spireNode.position.y = height + Float(spire.height) / 2
            spireNode.castsShadow = false
            parent.addChildNode(spireNode)
        } else if building.isLandmark {
            let flag = SCNSphere(radius: 0.9)
            flag.segmentCount = 8
            flag.firstMaterial = emissive(UIColor(red: 0.95, green: 0.55, blue: 0.28, alpha: 1), emission: 0.7)
            let flagNode = SCNNode(geometry: flag)
            flagNode.position.y = height + 1.6
            flagNode.castsShadow = false
            parent.addChildNode(flagNode)
        }

        return parent
    }

    private func buildingMaterial(_ color: UIColor) -> SCNMaterial {
        let key = colorKey(color)
        if let cached = materialCache[key] { return cached }
        let mat = SCNMaterial()
        mat.diffuse.contents = color
        mat.emission.contents = color.withAlphaComponent(0.12)
        mat.lightingModel = .lambert
        mat.isDoubleSided = false
        materialCache[key] = mat
        return mat
    }

    private func emissive(_ color: UIColor, emission: CGFloat) -> SCNMaterial {
        let mat = SCNMaterial()
        mat.diffuse.contents = color
        mat.emission.contents = color.withAlphaComponent(emission)
        mat.lightingModel = .constant
        return mat
    }

    private func colorKey(_ color: UIColor) -> UInt32 {
        var r: CGFloat = 0, g: CGFloat = 0, b: CGFloat = 0, a: CGFloat = 0
        color.getRed(&r, green: &g, blue: &b, alpha: &a)
        let ri = UInt32(r * 255) << 16
        let gi = UInt32(g * 255) << 8
        let bi = UInt32(b * 255)
        return ri | gi | bi
    }

    private func uiColor(for building: GameBuilding) -> UIColor {
        if building.isLandmark {
            switch building.entityType {
            case .church: return UIColor(red: 0.93, green: 0.78, blue: 0.32, alpha: 1)
            case .castle: return UIColor(red: 0.70, green: 0.55, blue: 0.86, alpha: 1)
            case .museum: return UIColor(red: 0.24, green: 0.72, blue: 0.66, alpha: 1)
            case .statue, .landmark: return UIColor(red: 0.95, green: 0.52, blue: 0.28, alpha: 1)
            case .restaurant: return UIColor(red: 0.92, green: 0.42, blue: 0.40, alpha: 1)
            default: return UIColor(red: 0.38, green: 0.72, blue: 0.86, alpha: 1)
            }
        }
        let seed = abs(building.id.hashValue % 5)
        let palette = [
            UIColor(red: 0.28, green: 0.40, blue: 0.55, alpha: 1),
            UIColor(red: 0.32, green: 0.46, blue: 0.58, alpha: 1),
            UIColor(red: 0.24, green: 0.36, blue: 0.50, alpha: 1),
            UIColor(red: 0.35, green: 0.42, blue: 0.52, alpha: 1),
            UIColor(red: 0.22, green: 0.34, blue: 0.48, alpha: 1)
        ]
        return palette[seed]
    }

    private func estimatedRadius(_ buildings: [GameBuilding], origin: CLLocationCoordinate2D) -> Float {
        var maxD: Float = 40
        for b in buildings {
            let p = Geo.localPoint(lat: b.coordinate.latitude, lng: b.coordinate.longitude, origin: origin)
            maxD = max(maxD, hypot(p.x, p.y))
        }
        return maxD
    }
}

struct QuestSceneView: UIViewRepresentable {
    let buildings: [GameBuilding]
    let origin: CLLocationCoordinate2D
    let userLocation: CLLocationCoordinate2D?
    let selectedId: String?
    var onSelect: (GameBuilding) -> Void
    var resetToken: Int

    func makeCoordinator() -> QuestSceneController {
        QuestSceneController()
    }

    func makeUIView(context: Context) -> SCNView {
        let view = SCNView()
        context.coordinator.attach(view)
        context.coordinator.onSelectBuilding = onSelect
        context.coordinator.rebuild(buildings: buildings, origin: origin, userLocation: userLocation)
        context.coordinator.select(buildingId: selectedId)
        return view
    }

    func updateUIView(_ uiView: SCNView, context: Context) {
        let controller = context.coordinator
        controller.onSelectBuilding = onSelect
        let signature = QuestSceneController.signature(buildings)
        if signature != controller.buildingSignature {
            controller.rebuild(buildings: buildings, origin: origin, userLocation: userLocation)
        } else if let userLocation {
            controller.placeUser(at: userLocation)
        }
        controller.select(buildingId: selectedId)
        if resetToken != controller.lastResetToken {
            controller.lastResetToken = resetToken
            if resetToken > 0 {
                controller.resetCamera(animated: true)
            }
        }
    }
}
