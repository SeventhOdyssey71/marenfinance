import SwiftUI

// MARK: - AppRouter
//
// A tiny shared navigator so one screen can send you to another: Home's "Borrow" tile jumps to
// the Finance tab's Vault segment, "Earn" to its Earn segment. Kept deliberately small — it
// carries which tab is showing and which Finance segment, nothing more.

enum AppTab: Hashable { case home, finance, activity, profile }
enum FinanceTab: Hashable { case vault, earn }

@MainActor
@Observable
final class AppRouter {
    var tab: AppTab = .home
    var financeTab: FinanceTab = .vault

    func goToVault() { financeTab = .vault; tab = .finance }
    func goToEarn() { financeTab = .earn; tab = .finance }
}
