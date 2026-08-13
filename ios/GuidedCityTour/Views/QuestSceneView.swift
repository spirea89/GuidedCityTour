import Foundation
import SceneKit
import SwiftUI
import UIKit
import CoreLocation

final class QuestSceneController: NSObject {
    let scene = SCNScene()
    private(set) var buildingNodes: [String: SCNNode] = [:]
    private var selectedId: String?
    private var origin = CLLocationCoordinate2D(latitude: 0, longitude: 0)
    private var userNode: SCNNode?
    private weak var scnView: SCNView?

    var onSelectBuilding: ((GameBuilding) -> Void)?
    private var buildingsById: [String: GameBuilding] = [:]
    var lastResetToken = 0

    func attach(_ view: SCNView) {
        scnView = view
        view.scene = scene
        view.backgroundColor = UIColor(red: 0.04, green: 0.07, blue: 0.12, alpha: 1)
        view.antialiasingMode = .multisampling4X
        view.allowsCameraControl = true
        view.defaultCameraController.interactionMode = .orbitTurntable
        view.defaultCameraController.minimumVerticalAngle = 12
        view.defaultCameraController.maximumVerticalAngle = 85
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
        scene.rootNode.childNodes.forEach { $0.removeFromParentNode() }
        buildingNodes.removeAll()
        buildingsById = Dictionary(uniqueKeysWithValues: buildings.map { ($0.id, $0) })
        self.origin = origin
        selectedId = nil

        addLights()
        addGround(radius: estimatedRadius(buildings, origin: origin))
        addGrid(radius: estimatedRadius(buildings, origin: origin))

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
        if userNode == nil {
            let glow = SCNSphere(radius: 2.4)
            glow.firstMaterial = emissive(UIColor(red: 0.36, green: 0.55, blue: 0.94, alpha: 1), emission: 0.85)
            let node = SCNNode(geometry: glow)
            node.name = "you-are-here"
            let ring = SCNTorus(ringRadius: 4.2, pipeRadius: 0.28)
            ring.firstMaterial = emissive(UIColor(red: 0.36, green: 0.55, blue: 0.94, alpha: 0.9), emission: 0.6)
            let ringNode = SCNNode(geometry: ring)
            ringNode.eulerAngles.x = .pi / 2
            node.addChildNode(ringNode)
            let pulse = SCNAction.repeatForever(
                .sequence([
                    .scale(to: 1.18, duration: 1.1),
                    .scale(to: 1.0, duration: 1.1)
                ])
            )
            ringNode.runAction(pulse)
            scene.rootNode.addChildNode(node)
            userNode = node
        }
        userNode?.position = SCNVector3(p.x, 2.6, p.y)
    }

    func select(buildingId: String?) {
        if let previous = selectedId, let node = buildingNodes[previous] {
            node.childNode(withName: "glow", recursively: false)?.removeFromParentNode()
            node.position.y = 0
        }
        selectedId = buildingId
        guard let buildingId, let node = buildingNodes[buildingId] else { return }
        let glowBox = SCNBox(width: 1, height: 1, length: 1, chamferRadius: 0)
        glowBox.firstMaterial = emissive(UIColor(red: 0.24, green: 0.95, blue: 0.82, alpha: 0.35), emission: 0.4)
        // Use a torus halo instead of a box overlay
        let halo = SCNTorus(ringRadius: 6, pipeRadius: 0.35)
        halo.firstMaterial = emissive(UIColor(red: 0.24, green: 0.95, blue: 0.82, alpha: 1), emission: 1)
        let haloNode = SCNNode(geometry: halo)
        haloNode.name = "glow"
        haloNode.position.y = 1.2
        haloNode.eulerAngles.x = .pi / 2
        node.addChildNode(haloNode)
        node.position.y = 1.4
        _ = glowBox
    }

    func resetCamera(animated: Bool) {
        guard let view = scnView else { return }
        let radius = max(40, estimatedRadius(Array(buildingsById.values), origin: origin) * 1.35)
        let camera = SCNCamera()
        camera.fieldOfView = 42
        camera.zFar = 4000
        camera.zNear = 0.5
        camera.wantsHDR = true
        let node = SCNNode()
        node.camera = camera
        node.position = SCNVector3(radius * 0.55, radius * 0.72, radius * 0.85)
        node.look(at: SCNVector3(0, 4, 0))
        view.pointOfView = node
        if animated {
            SCNTransaction.begin()
            SCNTransaction.animationDuration = 0.55
            view.pointOfView = node
            SCNTransaction.commit()
        }
    }

    @objc private func handleTap(_ gesture: UITapGestureRecognizer) {
        guard let view = scnView else { return }
        let point = gesture.location(in: view)
        let hits = view.hitTest(point, options: [
            SCNHitTestOption.searchMode: SCNHitTestSearchMode.closest
        ])
        for hit in hits {
            var node: SCNNode? = hit.node
            while let current = node {
                if let id = current.name, buildingsById[id] != nil {
                    select(buildingId: id)
                    if let building = buildingsById[id] {
                        onSelectBuilding?(building)
                    }
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
        ambient.light?.color = UIColor(red: 0.22, green: 0.28, blue: 0.38, alpha: 1)
        ambient.light?.intensity = 500
        scene.rootNode.addChildNode(ambient)

        let key = SCNNode()
        key.light = SCNLight()
        key.light?.type = .directional
        key.light?.color = UIColor(red: 1.0, green: 0.93, blue: 0.82, alpha: 1)
        key.light?.intensity = 900
        key.light?.castsShadow = true
        key.light?.shadowMode = .deferred
        key.light?.shadowColor = UIColor(white: 0, alpha: 0.55)
        key.light?.shadowSampleCount = 8
        key.eulerAngles = SCNVector3(-0.75, 0.55, 0)
        scene.rootNode.addChildNode(key)

        let fill = SCNNode()
        fill.light = SCNLight()
        fill.light?.type = .directional
        fill.light?.color = UIColor(red: 0.45, green: 0.72, blue: 0.95, alpha: 1)
        fill.light?.intensity = 280
        fill.eulerAngles = SCNVector3(-0.2, -0.9, 0)
        scene.rootNode.addChildNode(fill)
    }

    private func addGround(radius: Float) {
        let size = CGFloat(max(180, radius * 2.6))
        let plane = SCNPlane(width: size, height: size)
        let mat = SCNMaterial()
        mat.diffuse.contents = UIColor(red: 0.09, green: 0.14, blue: 0.20, alpha: 1)
        mat.roughness.contents = 0.9
        plane.materials = [mat]
        let node = SCNNode(geometry: plane)
        node.eulerAngles.x = -.pi / 2
        node.position.y = -0.05
        scene.rootNode.addChildNode(node)
    }

    private func addGrid(radius: Float) {
        let span = Int(max(8, min(18, radius / 18)))
        let step: Float = 16
        let color = UIColor(red: 0.18, green: 0.32, blue: 0.38, alpha: 0.45)
        for i in -span...span {
            let a = makeLine(
                from: SCNVector3(Float(i) * step, 0.04, Float(-span) * step),
                to: SCNVector3(Float(i) * step, 0.04, Float(span) * step),
                color: color
            )
            let b = makeLine(
                from: SCNVector3(Float(-span) * step, 0.04, Float(i) * step),
                to: SCNVector3(Float(span) * step, 0.04, Float(i) * step),
                color: color
            )
            scene.rootNode.addChildNode(a)
            scene.rootNode.addChildNode(b)
        }
    }

    private func makeLine(from: SCNVector3, to: SCNVector3, color: UIColor) -> SCNNode {
        let vertices: [SCNVector3] = [from, to]
        let vertexData = vertices.withUnsafeBufferPointer { Data(buffer: $0) }
        let source = SCNGeometrySource(
            data: vertexData,
            semantic: .vertex,
            vectorCount: 2,
            usesFloatComponents: true,
            componentsPerVector: 3,
            bytesPerComponent: MemoryLayout<Float>.size,
            dataOffset: 0,
            dataStride: MemoryLayout<SCNVector3>.stride
        )
        let indices: [UInt8] = [0, 1]
        let element = SCNGeometryElement(
            data: Data(indices),
            primitiveType: .line,
            primitiveCount: 1,
            bytesPerIndex: 1
        )
        let geo = SCNGeometry(sources: [source], elements: [element])
        geo.firstMaterial = SCNMaterial()
        geo.firstMaterial?.diffuse.contents = color
        geo.firstMaterial?.emission.contents = color
        geo.firstMaterial?.lightingModel = .constant
        return SCNNode(geometry: geo)
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

        let height = Float(max(5, min(building.heightMeters, 55)))
        let color = uiColor(for: building)
        let body: SCNNode
        if building.footprint.count >= 4 {
            body = extrudedFootprint(building.footprint, height: height, color: color, origin: origin, center: building.coordinate)
        } else {
            let span = Geo.boundingSpan(building.footprint.isEmpty ? [building.coordinate] : building.footprint)
            let box = SCNBox(
                width: CGFloat(max(6, min(span.width, 28))),
                height: CGFloat(height),
                length: CGFloat(max(6, min(span.depth, 28))),
                chamferRadius: building.isLandmark ? 0.8 : 0.25
            )
            box.firstMaterial = buildingMaterial(color)
            body = SCNNode(geometry: box)
            body.position.y = height / 2
        }
        parent.addChildNode(body)

        if building.entityType == .church {
            let spire = SCNCone(topRadius: 0.2, bottomRadius: 3.2, height: CGFloat(height * 0.55))
            spire.firstMaterial = buildingMaterial(UIColor(red: 0.95, green: 0.82, blue: 0.38, alpha: 1))
            let spireNode = SCNNode(geometry: spire)
            spireNode.position.y = height + Float(spire.height) / 2
            parent.addChildNode(spireNode)
        } else if building.entityType == .castle {
            addBattlements(to: parent, height: height, color: color)
        } else if building.isLandmark {
            let flag = SCNSphere(radius: 1.1)
            flag.firstMaterial = emissive(UIColor(red: 0.95, green: 0.55, blue: 0.28, alpha: 1), emission: 0.8)
            let flagNode = SCNNode(geometry: flag)
            flagNode.position.y = height + 2.2
            parent.addChildNode(flagNode)
        }

        if building.hasProperName {
            parent.addChildNode(makeNameBillboard(building.displayName, y: height + 3.5))
        }

        return parent
    }

    private func extrudedFootprint(
        _ footprint: [CLLocationCoordinate2D],
        height: Float,
        color: UIColor,
        origin: CLLocationCoordinate2D,
        center: CLLocationCoordinate2D
    ) -> SCNNode {
        let path = UIBezierPath()
        let pts = footprint.map {
            Geo.localPoint(lat: $0.latitude, lng: $0.longitude, origin: origin)
        }
        let c = Geo.localPoint(lat: center.latitude, lng: center.longitude, origin: origin)
        guard let first = pts.first else {
            let box = SCNBox(width: 8, height: CGFloat(height), length: 8, chamferRadius: 0.2)
            box.firstMaterial = buildingMaterial(color)
            let node = SCNNode(geometry: box)
            node.position.y = height / 2
            return node
        }
        path.move(to: CGPoint(x: CGFloat(first.x - c.x), y: CGFloat(first.y - c.y)))
        for pt in pts.dropFirst() {
            path.addLine(to: CGPoint(x: CGFloat(pt.x - c.x), y: CGFloat(pt.y - c.y)))
        }
        path.close()
        path.flatness = 0.5

        let shape = SCNShape(path: path, extrusionDepth: CGFloat(height))
        shape.firstMaterial = buildingMaterial(color)
        let node = SCNNode(geometry: shape)
        node.eulerAngles.x = -.pi / 2
        node.position.y = height / 2
        return node
    }

    private func addBattlements(to parent: SCNNode, height: Float, color: UIColor) {
        for i in 0..<4 {
            let merlon = SCNBox(width: 1.6, height: 2.4, length: 1.6, chamferRadius: 0.1)
            merlon.firstMaterial = buildingMaterial(color)
            let node = SCNNode(geometry: merlon)
            let angle = Float(i) * .pi / 2
            node.position = SCNVector3(cos(angle) * 5.5, height + 1.2, sin(angle) * 5.5)
            parent.addChildNode(node)
        }
    }

    private func makeNameBillboard(_ text: String, y: Float) -> SCNNode {
        let label = SCNText(string: String(text.prefix(28)), extrusionDepth: 0.15)
        label.font = UIFont.systemFont(ofSize: 4.2, weight: .semibold)
        label.flatness = 0.2
        label.firstMaterial = emissive(.white, emission: 0.2)
        let node = SCNNode(geometry: label)
        let (minB, maxB) = node.boundingBox
        node.pivot = SCNMatrix4MakeTranslation((minB.x + maxB.x) / 2, minB.y, (minB.z + maxB.z) / 2)
        node.scale = SCNVector3(0.35, 0.35, 0.35)
        node.position.y = y
        node.constraints = [SCNBillboardConstraint()]
        return node
    }

    private func buildingMaterial(_ color: UIColor) -> SCNMaterial {
        let mat = SCNMaterial()
        mat.diffuse.contents = color
        mat.emission.contents = color.withAlphaComponent(0.18)
        mat.roughness.contents = 0.62
        mat.metalness.contents = 0.12
        mat.lightingModel = .physicallyBased
        return mat
    }

    private func emissive(_ color: UIColor, emission: CGFloat) -> SCNMaterial {
        let mat = SCNMaterial()
        mat.diffuse.contents = color
        mat.emission.contents = color.withAlphaComponent(emission)
        mat.lightingModel = .constant
        return mat
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
        context.coordinator.onSelectBuilding = onSelect
        let controller = context.coordinator
        let needsRebuild = controller.buildingNodes.keys.sorted() != buildings.map(\.id).sorted()
        if needsRebuild {
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
