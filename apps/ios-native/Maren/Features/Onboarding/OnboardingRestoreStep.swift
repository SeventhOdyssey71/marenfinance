import SwiftUI
import AVFoundation
import UIKit

// MARK: - Restore step (sign in)
//
// "Sign in" for a non-custodial app is restoring a key you already hold. Two ways in — paste it,
// or scan a QR of it — and one gate: `Keystore.normalise`, the same validator the app has always
// used, run entirely on the device. Nothing is checked against a server, because there is no
// server that knows about your wallet.
//
// The pre-audit warning stays exactly as it was worded. It is the most important sentence on
// this screen and it is not softened.

struct OnboardingRestoreStep: View {
    var onBack: () -> Void
    var onKey: (Data, String) -> Void

    @State private var entry = ""
    @State private var error: String?
    @State private var scanning = false

    var body: some View {
        OnboardingScreen(onBack: onBack, stepCount: 3, stepIndex: 0) {
            Spacer(minLength: Theme.Space.sm)
            OnboardingSymbolFocal(symbol: "key.fill", diameter: 108, symbolSize: 44)
            OnboardingTitle(
                headline: "Restore your wallet",
                subhead: "Paste the private key for the wallet you want to use. It is checked here on this device and never sent anywhere."
            )
            OnboardingField(
                label: "Private key",
                placeholder: "0x…",
                text: $entry,
                mono: true,
                axis: .vertical,
                submitLabel: .go,
                showsPaste: true,
                onSubmit: submit
            )
            if let error {
                OnboardingNote(text: error, symbol: "exclamationmark.triangle.fill", tone: .bad)
                    .accessibilityAddTraits(.isStaticText)
            }
            OnboardingNote(
                text: "Never paste a key you use with real funds into a pre-audit build.",
                symbol: "hand.raised.fill",
                tone: .caution
            )
            Spacer(minLength: Theme.Space.sm)
        } footer: {
            OnboardingCTA(title: "Restore wallet", action: submit)
            OnboardingGhostButton(title: "Scan a QR code", icon: "qrcode.viewfinder") {
                OnboardingHaptics.tap()
                scanning = true
            }
            .accessibilityHint("Opens the camera to read a private key from a QR code.")
        }
        .sheet(isPresented: $scanning) {
            OnboardingKeyScanner { scanned in
                scanning = false
                entry = scanned
                submit()
            }
        }
    }

    /// Validate on submit, never by disabling the button — a dead pill explains nothing, an
    /// error message does.
    private func submit() {
        let raw = entry.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !raw.isEmpty else {
            fail("Paste your private key first, or scan its QR code.")
            return
        }
        guard let key = Keystore.normalise(raw) else {
            fail("That is not a valid private key. It should be 64 hexadecimal characters, with or without a 0x prefix.")
            return
        }
        guard let address = try? Keystore.address(of: key) else {
            fail("No address could be derived from that key.")
            return
        }
        error = nil
        entry = ""            // the pasted key does not linger in a field behind the next screen
        onKey(key, address)
    }

    private func fail(_ message: String) {
        error = message
        OnboardingHaptics.failure()
        UIAccessibility.post(notification: .announcement, argument: message)
    }
}

// MARK: - Key scanner
//
// A QR reader scoped to one job: read a private key. It refuses anything that is not one rather
// than handing an arbitrary scanned string to the importer, and it never routes payment or claim
// links — that is ScanView's job, inside the app. Where there is no camera (the Simulator, a
// declined permission) it says so plainly and sends you back to the paste field, which works.

struct OnboardingKeyScanner: View {
    var onKey: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    private enum Camera { case checking, ready, unavailable(String) }
    @State private var camera: Camera = .checking
    @State private var rejected = false

    var body: some View {
        ZStack {
            OnboardingGradient().ignoresSafeArea()
            VStack(spacing: Theme.Space.lg) {
                header
                switch camera {
                case .checking:
                    Spacer()
                case .ready:
                    KeyQRPreview { found($0) }
                        .frame(height: 320)
                        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: Theme.Radius.card, style: .continuous)
                                .strokeBorder(.white.opacity(0.5), lineWidth: 2)
                                .padding(36)
                                .allowsHitTesting(false)
                        )
                        .accessibilityLabel("Camera viewfinder. Point it at the QR code of your private key.")
                    OnboardingNote(text: rejected
                                   ? "That code is not a private key."
                                   : "Point the camera at the QR code of your private key.",
                                   symbol: rejected ? "exclamationmark.triangle.fill" : "viewfinder",
                                   tone: rejected ? .bad : .neutral)
                    Spacer()
                case .unavailable(let reason):
                    OnboardingSymbolFocal(symbol: "camera.metering.unknown", diameter: 108, symbolSize: 42)
                    OnboardingTitle(headline: "No camera here", subhead: reason)
                    Spacer()
                }
                OnboardingGhostButton(title: "Paste it instead") { dismiss() }
            }
            .padding(.horizontal, Theme.Space.lg)
            .padding(.bottom, Theme.Space.md)
        }
        .preferredColorScheme(.light)
        .task { await prepare() }
    }

    private var header: some View {
        HStack {
            Text("Scan your key")
                .font(.rounded(20, weight: .semibold))
                .foregroundStyle(OnboardingPalette.heading)
            Spacer(minLength: 0)
            Button { dismiss() } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(OnboardingPalette.heading)
                    .frame(width: 44, height: 44)
                    .background(OnboardingPalette.quiet, in: Circle())
            }
            .buttonStyle(OnboardingPressStyle())
            .accessibilityLabel("Close the scanner")
        }
        .frame(height: 56)
    }

    private func found(_ raw: String) {
        guard Keystore.normalise(raw) != nil else {
            rejected = true
            OnboardingHaptics.failure()
            return
        }
        rejected = false
        onKey(raw.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    private func prepare() async {
        #if targetEnvironment(simulator)
        camera = .unavailable("This simulator has no camera. Paste your key on the previous screen instead.")
        #else
        guard AVCaptureDevice.default(for: .video) != nil else {
            camera = .unavailable("This device has no usable camera. Paste your key instead.")
            return
        }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            camera = .ready
        case .notDetermined:
            let granted = await AVCaptureDevice.requestAccess(for: .video)
            camera = granted ? .ready : .unavailable("Camera access was declined. You can paste your key instead.")
        default:
            camera = .unavailable("Camera access is off for Maren. Turn it on in Settings, or paste your key instead.")
        }
        #endif
    }
}

// MARK: - AVFoundation preview

private struct KeyQRPreview: UIViewControllerRepresentable {
    let onFound: (String) -> Void

    func makeUIViewController(context: Context) -> KeyScannerController {
        let controller = KeyScannerController()
        controller.onFound = onFound
        return controller
    }
    func updateUIViewController(_ controller: KeyScannerController, context: Context) {}
}

private final class KeyScannerController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
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
