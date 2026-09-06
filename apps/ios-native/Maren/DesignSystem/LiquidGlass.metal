//
//  LiquidGlass.metal
//  Maren
//
//  A real Metal fragment shader, run by SwiftUI's `.layerEffect(_:maxSampleOffset:)`, that
//  makes a piece of flat vector artwork read as a solid piece of GLASS rather than a flat fill.
//
//  Why a shader at all, and why this one
//  ------------------------------------
//  The brief was "the look of metal-fx", a WebGL React component. This app is SwiftUI, so the
//  package itself is unusable; but iOS 17 exposes the same primitive underneath it — a stitchable
//  fragment function that SwiftUI hands the rasterised layer to. So the effect is written here,
//  natively, with no new dependency.
//
//  Glass is not a colour, it is four behaviours, and this shader does exactly those four and
//  stops:
//
//    1. REFRACTION. Light bends as it passes through a body of glass, so what you see through
//       it is displaced. The whole glyph is sampled through a slow two-frequency sine warp of a
//       couple of pixels. Because the mark is a solid violet field, a two-pixel warp is invisible
//       in the interior and only bends the SILHOUETTE — exactly what a thick glass cut does.
//    2. DISPERSION. Glass splits wavelengths. Red and blue are read a hair further along the
//       warp than green. Inside the flat body all three samples land on the same colour and
//       nothing happens; only where the alpha or colour changes — the edge — do they disagree,
//       so the chromatic fringe appears where real glass would put it and nowhere else.
//    3. SPECULAR SHEEN. A wide gaussian band of near-white travels across the glyph on a
//       diagonal, with a second, much narrower and slightly faster "caustic" line riding behind
//       it. Two bands are what separate a piece of glass turning in the light from a flat
//       gradient wipe.
//    4. INTERNAL DENSITY. A very low-amplitude luminance ripple through the body, so the glass
//       has thickness instead of being a sheet.
//
//  Everything is multiplied by the layer's own alpha, so the effect exists ONLY on the artwork.
//  The near-white page behind it is never touched, never darkened, never tinted — the light
//  world of the onboarding flow is unchanged.
//
//  Cost: three texture samples, a handful of sin/cos and two exp per fragment, no loops and no
//  branches on the hot path. Over a 108–148pt focal that is a rounding error.
//

#include <metal_stdlib>
#include <SwiftUI/SwiftUI_Metal.h>

using namespace metal;

namespace maren {

/// A soft gaussian band centred at `centre`, in the same units as `d`.
/// `exp(-x^2)` rather than a smoothstep: a specular highlight has no hard shoulder.
static inline float band(float d, float centre, float width) {
    float x = (d - centre) / max(width, 1e-4f);
    return exp(-x * x);
}

}  // namespace maren

/// The liquid-glass treatment.
///
/// - position: fragment position, in the layer's own coordinate space (points).
/// - layer:    the rasterised view underneath, premultiplied.
/// - size:     the layer's size in points, so the effect is resolution-independent.
/// - time:     seconds. Held at a fixed value to freeze the effect (Reduce Motion).
/// - strength: 0 = artwork untouched, 1 = the tuned default, >1 exaggerates. Scales the
///             refraction, the dispersion and the internal density together.
/// - sheen:    the specular pass on its own, so a screen can keep the refraction and dial the
///             travelling highlight down (or up) independently.
/// - tint:     the brand colour the sheen is warmed towards, so the highlight belongs to the
///             artwork instead of reading as a generic white wipe.
[[stitchable]] half4 marenLiquidGlass(float2 position,
                                      SwiftUI::Layer layer,
                                      float2 size,
                                      float time,
                                      float strength,
                                      float sheen,
                                      half4 tint)
{
    float2 extent = max(size, float2(1.0f));
    float2 uv = position / extent;
    float2 centred = uv - 0.5f;
    float t = time;

    // ---- The lighting event ------------------------------------------------------------
    // Everything else keys off this, because in real glass the refraction, the dispersion and
    // the highlight are ONE event — the light source moving — not three independent effects.
    //
    // Projected onto a down-right diagonal, which is the axis the Maren swoosh already runs on,
    // so the highlight travels ALONG the artwork rather than across it.
    const float2 axis = normalize(float2(0.82f, 0.57f));
    float d = dot(centred, axis);

    // The travel is taken well past the glyph at both ends (|1.15| against a shape that only
    // reaches ~0.7) so the band is completely off the artwork at the moment the phase wraps.
    // Without that margin the loop point is a visible pop.
    float sweep = mix(-1.15f, 1.15f, fract(t * 0.160f));
    // A broad glow with one crisp core line riding just behind it, at a fixed offset. Two
    // INDEPENDENT wipes read as two gradients; one glow plus its own hot line reads as a solid
    // edge turning into the light. One pass every 6.25s: a slow turn, not a shimmer.
    float wide = maren::band(d, sweep, 0.185f);
    float core = maren::band(d, sweep + 0.090f, 0.030f);

    // Displacements are in POINTS, so without this a 1.5pt warp that is a whisper across a
    // 108pt brand mark is a landslide across the 6pt stroke of a 44pt SF Symbol. Scaling by the
    // layer's own size makes the glass OPTICALLY the same at every focal size, which is why the
    // call sites can share one set of numbers. Capped at 1 so the Swift side's
    // `maxSampleOffset` stays the true worst case.
    float sizeScale = clamp(max(extent.x, extent.y) / 120.0f, 0.50f, 1.00f);

    // ---- 1. Refraction -----------------------------------------------------------------
    // Two frequencies per axis at incommensurable rates, so the surface never visibly repeats
    // over the seconds the highlight takes to cross. Deliberately small: the glyph has to stay
    // unmistakably the Maren mark.
    float amp = 1.35f * strength * sizeScale;
    float2 warp = amp * float2(
        sin(uv.y * 5.7f + t * 0.85f) + 0.5f * sin(uv.x * 3.1f - t * 0.55f),
        cos(uv.x * 5.1f - t * 0.70f) + 0.5f * cos(uv.y * 3.7f + t * 0.45f));

    // ---- 2. Dispersion -----------------------------------------------------------------
    // Radial, the way a lens splits light, and mostly GATED ON THE HIGHLIGHT: a thin resting
    // fringe everywhere, opening up to three times that only where the sweep is passing. A
    // constant fringe just looks like a misregistered print; one that travels with the light
    // looks like glass.
    float k = 0.90f * strength * sizeScale * (0.28f + 0.72f * wide);
    float2 chroma = normalize(centred + float2(1e-4f, 1e-4f)) * k;

    half4 g = layer.sample(position + warp);
    half4 r = layer.sample(position + warp + chroma);
    half4 b = layer.sample(position + warp - chroma);

    half a = g.a;
    // Fully transparent fragments stay fully transparent. Nothing is ever painted onto the page.
    if (a <= 0.004h) {
        return half4(0.0h);
    }

    // Un-premultiply so the shading can be reasoned about as ordinary colour, then
    // re-premultiply on the way out.
    half3 col = half3(r.r, g.g, b.b) / a;

    // ---- 3. Body shading ---------------------------------------------------------------
    // A signed lift along the same axis: the upper-left face catches light, the lower-right
    // falls away. Multiplicative, so it deepens the violet rather than washing it towards grey,
    // and it is FIXED — it is what gives a completely frozen frame (Reduce Motion) a direction
    // instead of leaving flat artwork.
    col *= half(1.0f + 0.085f * clamp(-d * 1.7f, -1.0f, 1.0f));

    // ±3.5% luminance drifting through the body on its own rate. Just enough to stop the
    // interior reading as a printed shape.
    col *= half(1.0f + 0.035f * sin(uv.x * 4.3f + uv.y * 3.1f - t * 0.60f) * strength);

    // ---- 4. Specular sheen -------------------------------------------------------------
    // The edge, for free: where the two dispersion samples disagree in coverage. A whisper of
    // rim light there is what tells the eye the body has a thickness.
    half rim = clamp(abs(r.a - b.a) * 1.6h, 0.0h, 1.0h);
    // Weighted towards the CORE line rather than the glow. The broad band is what washes a
    // saturated brand colour out towards white when it passes, so it is kept to a lift; the
    // drama is carried by the thin line, which is only ever a few points wide.
    float spec = (wide * 0.26f + core * 0.42f + float(rim) * 0.14f) * sheen;

    // Near-white, warmed a little towards the brand colour. A pure-white highlight on violet
    // reads as a blown-out screenshot; 18% of the tint keeps it inside the palette.
    half3 sheenColour = mix(half3(1.0h), tint.rgb, 0.18h);
    col = col + sheenColour * half(spec);

    col = clamp(col, half3(0.0h), half3(1.0h));
    return half4(col * a, a);
}
