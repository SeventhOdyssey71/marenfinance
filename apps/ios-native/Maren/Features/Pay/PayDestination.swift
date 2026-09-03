import SwiftUI

// MARK: - PayDestination
//
// The set of money flows launched from Home (and Scan). One enum + one sheet builder so every
// entry point opens the same flow, and adding a launch site never re-wires the flows.

enum PayDestination: String, Identifiable, CaseIterable {
    case send, receive, request, split, link, claim, scan
    var id: String { rawValue }

    var title: String {
        switch self {
        case .send: return "Send"
        case .receive: return "Receive"
        case .request: return "Request"
        case .split: return "Split"
        case .link: return "Link"
        case .claim: return "Claim"
        case .scan: return "Scan"
        }
    }

    var icon: String {
        switch self {
        case .send: return "arrow.up.right"
        case .receive: return "arrow.down.left"
        case .request: return "arrow.down.circle"
        case .split: return "person.2"
        case .link: return "link"
        case .claim: return "gift"
        case .scan: return "qrcode.viewfinder"
        }
    }

    /// Send and the pay flows are full-screen pages; Receive is a bottom-sheet overlay.
    var isFullScreen: Bool { self != .receive }

    @ViewBuilder var view: some View {
        switch self {
        case .send: SendFlow()
        case .receive: ReceiveView()
        case .request: RequestFlow()
        case .split: SplitFlow()
        case .link: ClaimableLinkFlow()
        case .claim: ClaimFlow()
        case .scan: ScanView()
        }
    }
}
