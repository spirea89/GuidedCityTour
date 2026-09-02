import SwiftUI

enum QuestTheme {
    static let accent = Color(red: 0.24, green: 0.72, blue: 0.66)
    static let accentHover = Color(red: 0.31, green: 0.82, blue: 0.75)
    static let bgDeep = Color(red: 0.043, green: 0.071, blue: 0.125)
    static let bgPanel = Color(red: 0.071, green: 0.102, blue: 0.169)
    static let bgHeader = Color(red: 0.055, green: 0.086, blue: 0.149)
    static let border = Color(red: 0.141, green: 0.188, blue: 0.286)
    static let text = Color(red: 0.910, green: 0.933, blue: 0.973)
    static let muted = Color(red: 0.561, green: 0.627, blue: 0.722)
    static let youHere = Color(red: 0.357, green: 0.553, blue: 0.937)
    static let error = Color(red: 0.941, green: 0.443, blue: 0.471)
    static let gold = Color(red: 0.95, green: 0.78, blue: 0.32)
    static let landmark = Color(red: 0.95, green: 0.55, blue: 0.28)
}

enum AppIdentity {
    static let displayName = "City Quest"
    static let subtitle = "Guided City Tour"
    static let version = "3.1.0"
    static let pipelineVersion = "3.1.0"
}
