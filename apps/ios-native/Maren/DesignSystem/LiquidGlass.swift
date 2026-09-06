import SwiftUI
import Metal

// MARK: - Liquid glass
//
// The SwiftUI side of `LiquidGlass.metal`: a reusable modifier that drives the shader's `time`
// uniform and hands it its tuning. It exists so a focal element can be made of glass by adding
// one line to it, and so every focal in the app is made of the SAME glass.
//
// Three things this wrapper is responsible for, none of which the shader can do for itself:
//
//   REDUCE MOTION. When Reduce Motion is on the TimelineView is not built at all — not slowed,
//   not shortened, not present. The shader still runs, once, at the style's own `stillTime`,
//   chosen per shape so the frozen highlight flatters that shape. The result is a still, lit
//   piece of glass, which is the honest static form of the effect rather than a downgrade to
//   flat artwork.
//
//   FALLBACK. A shader that fails to compile or link does not throw — SwiftUI simply draws
//   nothing, and a focal element that is a hole is far worse than one that is flat. So the
//   Metal default library is probed ONCE, at first use, for the stitchable function's symbol.
//   If it is not there (no Metal device, no default.metallib, function stripped) every call
//   site silently renders the plain artwork it was given.
//
//   SCOPE OF REDRAW. The TimelineView wraps only the artwork it is applied to. It is applied
//   at the leaf — inside `MarenBrandMark` and `OnboardingSymbolFocal` — never around a screen,
//   so a frame tick invalidates a ~130pt subtree and nothing else on the page. The effect also
//   stops entirely when the scene is not active, so a backgrounded app never animates.

// MARK: - Tuning

/// The knobs a call site is allowed to turn. Defaults are the tuned house look; a screen that
/// needs a quieter or louder piece of glass changes a number, never the shader.
struct LiquidGlassStyle: Equatable {
    /// Overall depth of the glass: refraction amplitude, dispersion at the edges and the
    /// internal density ripple. 0 leaves the artwork untouched, 1 is the shader's own base.
    var strength: Double = 1.15
    /// The travelling specular highlight, dialled independently of the body.
    var sheen: Double = 1.45
    /// The rate of the whole effect — the sheen's crossing, the refraction and the density
    /// drift together, since they are one light source moving, so this is a multiplier on the
    /// shader's clock rather than on one term of it.
    ///
    /// The shader's base rate (1.0) is one specular pass every 6.25 seconds, which turned out to
    /// be slower than the time anyone spends looking at a focal element: the mark sat inert on
    /// the welcome screen for whole seconds at a stretch and the glass simply was not seen. At
    /// 2.0 a pass lands every ~3.1s, so a highlight crosses the mark within the first glance and
    /// again while the sentence underneath is being read. Fast enough to be noticed, still far
    /// off a shimmer: the body's refraction, now on a ~3.7s undulation, reads as liquid.
    var speed: Double = 2.0
    /// The colour the highlight is warmed towards. Defaults to the brand violet so the glass
    /// belongs to the mark; the protection step passes its outcome colour instead.
    var tint: Color = Theme.Palette.accent
    /// The frozen frame used when Reduce Motion is on, in the shader's OWN seconds — never
    /// scaled by `speed`, so retuning the rate can never drag the still frame off the phase it
    /// was chosen for.
    ///
    /// Not an arbitrary constant. At 2.72s the sweep is running along the upper flank of the
    /// Maren cut: the broad glow has lifted that side and the hot core line lies along the
    /// swoosh's long edge rather than across its waist. That is what a photograph of a glass
    /// object at rest looks like. It is also the one number that has to be picked per SHAPE,
    /// which is why it is a knob and not a constant — see `.symbol`.
    var stillTime: Double = 2.72

    /// The house default: violet glass on the brand mark, which is a large solid field and can
    /// carry the full body and a hot highlight without losing its silhouette.
    static let brand = LiquidGlassStyle()

    /// A restrained variant for a symbol that has to stay unambiguous as an ICON first.
    ///
    /// The shader already scales its displacements to the layer's size, but an SF Symbol is not
    /// a small solid field — it is 5–6pt strokes with a 1px antialiased edge, and a dispersion
    /// offset that is a whisper across the brand mark's body is a visible warm fringe along a
    /// stroke that thin. So the BODY is taken well down while the sheen is left high: the
    /// highlight is what reads as glass, the fringe is what reads as a rendering bug.
    ///
    /// This is why the symbol focals are deliberately QUIETER than the mark, and stay quieter
    /// after the house values were raised. Pushing the symbol's `strength` up with the brand's
    /// makes a 44pt `faceid` or `checkmark.shield` glyph look misregistered — a warm ghost
    /// beside every stroke — which reads as a bug in the app rather than as an effect. The
    /// symbols get the same faster, brighter LIGHT and less of the glass BODY.
    ///
    /// It also freezes on a DIFFERENT frame. A brightened sheen crossing a 6pt stroke takes that
    /// stroke to near-white, which is a lovely half-second while it is moving and a permanent
    /// hole in the icon once it stops: measured on the frozen frame, the hottest point of a
    /// `faceid` glyph fell to 1.2:1 against the page, i.e. that part of the icon was simply gone.
    /// So the symbols freeze at 2.07s, where the sweep is off the artwork entirely and the still
    /// is carried by the fixed body shading — the glyph keeps its full violet everywhere.
    static let symbol = LiquidGlassStyle(strength: 0.55, sheen: 1.15, stillTime: 2.07)

    /// The same glass, warmed towards a different colour — for a focal whose own tint changes
    /// with what it is saying.
    func tinted(_ colour: Color) -> LiquidGlassStyle {
        var copy = self
        copy.tint = colour
        return copy
    }
}

// MARK: - Availability probe

enum LiquidGlassSupport {
    /// Whether `marenLiquidGlass` is actually present in the app's compiled Metal library.
    ///
    /// Evaluated once, lazily, on first use. `ShaderLibrary` has no way to ask this — an
    /// unresolvable function only shows up as a missing draw at render time — so the default
    /// library is opened directly and its symbol table is searched. Any failure at any step
    /// means "no glass", and every call site falls back to the plain artwork.
    static let isAvailable: Bool = {
        guard let device = MTLCreateSystemDefaultDevice() else { return false }
        guard let library = device.makeDefaultLibrary() else { return false }
        // Stitchable functions are exported under a decorated name, so match on the substring
        // rather than on equality.
        return library.functionNames.contains { $0.contains("marenLiquidGlass") }
    }()
}

// MARK: - Clock

/// The one thing that will silently kill a SwiftUI shader: `time`.
///
/// A `Shader.Argument.float` is narrowed to a 32-bit float on the way into Metal, and
/// `Date.timeIntervalSinceReferenceDate` is around 7.8e8 — a magnitude at which a float's
/// mantissa can only step in units of about 64 SECONDS. Handed that value the shader is not
/// slow, it is FROZEN, and it looks exactly like a shader that was never wired up.
///
/// So time is measured from the first frame the effect ever draws. The numbers stay small
/// (seconds since launch), the precision stays sub-millisecond, and because the epoch is shared
/// by every call site two focals on screen at once stay in phase with each other.
private enum LiquidGlassClock {
    private static let epoch = Date.timeIntervalSinceReferenceDate

    static func seconds(at date: Date) -> Double {
        date.timeIntervalSinceReferenceDate - epoch
    }
}

// MARK: - Modifier

extension View {
    /// Renders this view as a live piece of glass.
    ///
    /// Apply it to the ARTWORK, not to a container: the modifier owns a `TimelineView`, and the
    /// smaller the subtree it wraps the less a frame tick costs. Accessibility is untouched —
    /// the view keeps whatever labels, traits and `accessibilityHidden` it already had.
    func liquidGlass(_ style: LiquidGlassStyle = .brand) -> some View {
        modifier(LiquidGlassModifier(style: style))
    }
}

private struct LiquidGlassModifier: ViewModifier {
    let style: LiquidGlassStyle

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase

    func body(content: Content) -> some View {
        if !LiquidGlassSupport.isAvailable || style.strength <= 0 {
            // No Metal, no shader, or explicitly disabled: the plain artwork, unchanged.
            content
        } else if reduceMotion || scenePhase != .active {
            // Reduce Motion: one still frame, no timeline, no invalidation, no ticking.
            // Not-active: an app in the background or in the app switcher never animates.
            content.liquidGlassFrame(style: style, time: style.stillTime)
        } else {
            TimelineView(.animation) { context in
                content.liquidGlassFrame(
                    style: style,
                    time: LiquidGlassClock.seconds(at: context.date) * style.speed
                )
            }
        }
    }
}

private extension View {
    /// One frame of the effect at a given `time`. Split out so the still path and the animated
    /// path are provably the same render, differing only in where `time` comes from.
    func liquidGlassFrame(style: LiquidGlassStyle, time: Double) -> some View {
        // The shader reads a couple of points OUTSIDE each fragment. Without room to do that the
        // warp would sample transparency at the artwork's own bounds and nibble the silhouette,
        // so the view is inset and the inset is immediately taken back — the effect gets its
        // margin and the layout is bit-for-bit what it was.
        let margin = LiquidGlassMetrics.margin(for: style.strength)
        return padding(margin)
            .visualEffect { view, proxy in
                view.layerEffect(
                    ShaderLibrary.marenLiquidGlass(
                        .float2(proxy.size),
                        .float(time),
                        .float(style.strength),
                        .float(style.sheen),
                        .color(style.tint)
                    ),
                    maxSampleOffset: CGSize(width: margin, height: margin)
                )
            }
            .padding(-margin)
    }
}

private enum LiquidGlassMetrics {
    /// The shader's worst-case read distance: the refraction amplitude (1.35pt, up to 1.5x once
    /// the two summed sines line up) plus the radial dispersion offset (0.9pt at its widest) —
    /// rounded up, with a point to spare.
    static func margin(for strength: Double) -> CGFloat {
        let refraction = 1.35 * 1.5 * strength
        let dispersion = 0.90 * strength
        return CGFloat((refraction + dispersion).rounded(.up)) + 1
    }
}
