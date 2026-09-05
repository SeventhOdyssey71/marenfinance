import Foundation

// MARK: - OnboardingFlags
//
// Two booleans about what a person chose during setup. Nothing here is key material, nothing
// here is secret, and nothing here gates security — these only decide whether the app is
// entitled to nag. UserDefaults is the right home for exactly that.
//
// `backupPending` is set when someone taps "Back up later" on the backup step. Backup is
// skippable by design: a wallet you cannot get into is worse than one you have not written down
// yet, so setup never blocks on it. Profile is expected to read this flag and offer the backup
// again, and to clear it once the key has actually been shown and saved.

enum OnboardingFlags {
    private static let backupKey = "finance.maren.swift.backupPending"

    /// True when a wallet was created on this device and its owner has not yet written the key
    /// down. Profile can surface a persistent "Back up your wallet" prompt off this.
    static var backupPending: Bool {
        get { UserDefaults.standard.bool(forKey: backupKey) }
        set { UserDefaults.standard.set(newValue, forKey: backupKey) }
    }

    /// Called when the key has been revealed and copied, or when the wallet was restored from a
    /// key its owner already holds — in both cases there is nothing left to nag about.
    static func markBackedUp() { backupPending = false }
}
