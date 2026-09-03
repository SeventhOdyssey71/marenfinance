import Foundation

// MARK: - HomeCache
//
// A persisted snapshot of the Home reads, so returning to the app paints the last-known
// balance, position and history instantly while a fresh read runs in the background. Keyed
// by wallet address (a JSON file in the caches directory). It is NEVER authoritative — the
// live reads always overwrite it, and a field only ever shows a stale-but-true value, never
// a fabricated one. It exists purely for a fast first paint.

struct HomeSnapshot: Codable {
    var account: Account?
    var position: Position?
    var balances: Balances?
    var priceFeed: PriceFeed?
    var activity: [ActivityItem]
    var savedAt: Date
}

enum HomeCache {
    private static var directory: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("maren-home", isDirectory: true)
    }

    private static func fileURL(for address: String) -> URL {
        directory.appendingPathComponent("home-\(address.lowercased()).json")
    }

    static func load(address: String) -> HomeSnapshot? {
        guard let data = try? Data(contentsOf: fileURL(for: address)) else { return nil }
        return try? JSONDecoder().decode(HomeSnapshot.self, from: data)
    }

    static func save(_ snapshot: HomeSnapshot, address: String) {
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        guard let data = try? JSONEncoder().encode(snapshot) else { return }
        try? data.write(to: fileURL(for: address), options: .atomic)
    }
}
