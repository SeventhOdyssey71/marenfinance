import SwiftUI
import CoreImage.CIFilterBuiltins

// MARK: - QRCode
//
// Renders a payment or claim link as a QR code, entirely on-device via CoreImage — no network,
// no third-party dependency. The string encoded is only ever a public payment payload; a claim
// link's bearer secret is shown once as text and is never turned into a shared code here.

struct QRCode: View {
    let string: String
    var size: CGFloat = 200

    private static let context = CIContext()

    var body: some View {
        if let image = render() {
            Image(uiImage: image)
                .interpolation(.none)
                .resizable()
                .frame(width: size, height: size)
                .background(Color.white)
                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.inset, style: .continuous))
                .accessibilityLabel("QR code for this payment")
        } else {
            RoundedRectangle(cornerRadius: Theme.Radius.inset, style: .continuous)
                .fill(Theme.Palette.inset)
                .frame(width: size, height: size)
                .overlay(Unavailable(label: "Could not render code"))
        }
    }

    private func render() -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(string.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage else { return nil }
        let scale = (size * 3) / output.extent.width
        let scaled = output.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        guard let cg = Self.context.createCGImage(scaled, from: scaled.extent) else { return nil }
        return UIImage(cgImage: cg)
    }
}
