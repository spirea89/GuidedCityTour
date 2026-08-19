import Foundation

enum SupabaseConfig {
    static let projectURL = "https://ifoybmzofjdgekvvrsot.supabase.co"
    /// Publishable client key — safe to ship in the app; access is limited by RLS.
    static let publishableKey = "sb_publishable_SUftoAM4bElr34PXERf_RQ_f9TZJcRl"
    static let storyTable = "place_research"
    static let locationsTable = "area_locations"
    static let storyTTLDays = 21
    static let locationsTTLDays = 14
}
