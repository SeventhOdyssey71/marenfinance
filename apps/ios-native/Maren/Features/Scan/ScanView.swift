import SwiftUI
import AVFoundation

// MARK: - Scan
//
// A camera QR scanner that routes a scanned Maren link into the right flow: a payment link
// opens Send pre-filled; a claim link is stashed in the one-slot in-memory handoff (never a
// nav param) and opens Claim. Anything that is not a Maren link is refused with an honest note
// rather than acted on. On a device with no camera (the simulator) or a denied permission, it
// falls back to a clean paste field so the flow is still reachable.

struct ScanView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var status: CameraStatus = .unknown
    @State private var pasted = ""
    @State private var rejected = false
    @State private var route: Route?

    enum CameraStatus { case unknown, ready, unavailable(String) }
    private enum Route: Identifiable {
        case send(PaymentLinks.PaymentPayload)
        case claim
        var id: String { switch self { case .send: return "send"; case .claim: return "claim" } }
    }

    var body: some View {
        FlowScreen(title: "Scan") {
            switch status {
            case .unknown:
                Color.clear.frame(height: 1)
            case .ready:
                scanner
            case .unavailable(let reason):
                unavailable(reason)
            }
            pasteFallback
        }
        .task { await prepareCamera() }
        .sheet(item: $route) { route in
            switch route {
            case .send(let payload): SendFlow(prefill: payload)
            case .claim: ClaimFlow()
            }
        }
    }

    private var scanner: some View {
        VStack(spacing: Theme.Space.sm) {
            QRScannerView { handle($0) }
                .frame(height: 300)
                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                        .strokeBorder(Color.white.opacity(0.5), lineWidth: 2)
                        .padding(40)
                        .allowsHitTesting(false)
                )
            Text("Point the camera at a Maren payment or claim QR.")
                .font(.system(size: 14)).foregroundStyle(Theme.Palette.muted)
        }
    }

    private func unavailable(_ reason: String) -> some View {
        HStack(alignment: .top, spacing: Theme.Space.sm) {
            Image(systemName: "camera.metering.unknown").font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Theme.Palette.warning).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text("Camera unavailable").font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.Palette.ink)
                Text(reason).font(.system(size: 14)).foregroundStyle(Theme.Palette.muted).fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(Theme.Space.md)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.Palette.inset.opacity(0.6), in: RoundedRectangle(cornerRadius: Theme.Radius.inset, style: .continuous))
    }

    private var pasteFallback: some View {
        VStack(alignment: .leading, spacing: Theme.Space.sm) {
            TextEntryCard(label: "Or paste a link", placeholder: "https://\(PaymentLinks.host)/…", text: $pasted,
                          footnote: rejected ? "That is not a Maren payment or claim link." : nil)
            SubmitBar(title: "Open link", enabled: !pasted.trimmingCharacters(in: .whitespaces).isEmpty) {
                handle(pasted)
            }
        }
    }

    private func handle(_ raw: String) {
        switch PaymentLinks.parse(raw) {
        case .payment(let payload):
            rejected = false
            route = .send(payload)
        case .claim(let link):
            rejected = false
            ClaimHandoff.shared.stash(link)   // the bearer secret never travels as a nav param
            route = .claim
        case .none:
            rejected = true
        }
    }

    private func prepareCamera() async {
        #if targetEnvironment(simulator)
        status = .unavailable("This simulator has no camera. Paste a link below to test the routing.")
        #else
        guard AVCaptureDevice.default(for: .video) != nil else {
            status = .unavailable("This device has no usable camera.")
            return
        }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            status = .ready
        case .notDetermined:
            let granted = await AVCaptureDevice.requestAccess(for: .video)
            status = granted ? .ready : .unavailable("Camera access was declined. You can paste a link instead.")
        default:
            status = .unavailable("Camera access is off for Maren. Turn it on in Settings, or paste a link.")
        }
        #endif
    }
}

// MARK: - QRScannerView (AVFoundation)

private struct QRScannerView: UIViewControllerRepresentable {
    let onFound: (String) -> Void

    func makeUIViewController(context: Context) -> ScannerController {
        let controller = ScannerController()
        controller.onFound = onFound
        return controller
    }
    func updateUIViewController(_ controller: ScannerController, context: Context) {}
}

private final class ScannerController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
    var onFound: ((String) -> Void)?
    private let session = AVCaptureSession()
    private var preview: AVCaptureVideoPreviewLayer?
    private var delivered = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        guard let device = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: device),
              session.canAddInput(input) else { return }
        session.addInput(input)

        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else { return }
        session.addOutput(output)
        output.setMetadataObjectsDelegate(self, queue: .main)
        output.metadataObjectTypes = [.qr]

        let preview = AVCaptureVideoPreviewLayer(session: session)
        preview.videoGravity = .resizeAspectFill
        view.layer.addSublayer(preview)
        self.preview = preview
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        preview?.frame = view.bounds
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        if !session.isRunning {
            DispatchQueue.global(qos: .userInitiated).async { [session] in session.startRunning() }
        }
    }

    override func viewDidDisappear(_ animated: Bool) {
        super.viewDidDisappear(animated)
        if session.isRunning { session.stopRunning() }
    }

    nonisolated func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput objects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard let object = objects.first as? AVMetadataMachineReadableCodeObject,
              let value = object.stringValue else { return }
        // The delegate queue is `.main`, so hopping onto the main actor here is safe.
        MainActor.assumeIsolated {
            guard !delivered else { return }
            delivered = true
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            onFound?(value)
        }
    }
}
