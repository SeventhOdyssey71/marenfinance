import './landing.css';

import { Nav } from '@/components/nav';
import { Hero } from '@/components/hero';
import { Stats } from '@/components/stats';
import { Surfaces } from '@/components/surfaces';
import { HowItWorks } from '@/components/how-it-works';
import { ProductMoment } from '@/components/product-moment';
import { BuiltOnMezo } from '@/components/built-on-mezo';
import { Faq } from '@/components/faq';
import { Footer } from '@/components/footer';

/**
 * Maren marketing landing — an engineering-blueprint editorial (construction
 * grid, corner ticks, mono microtype, bracket buttons) rendered in Maren's
 * light-violet brand. Structure follows Talise's v3 flow; every claim is a
 * defensible Maren fact.
 *
 * The whole page is scoped under `.landing`, which paints the light canvas and
 * re-derives the shared text/border tokens for it — so nothing here touches the
 * dark /app or /docs, or the @theme tokens they depend on.
 *
 * The "Skip to content" link was removed on the owner's direct instruction and
 * is intentionally not restored here; `<main id="main">` is kept regardless.
 */
export default function HomePage() {
  return (
    <div className="landing">
      <Nav />

      <main id="main">
        <Hero />
        <Stats />
        <Surfaces />
        <HowItWorks />
        <ProductMoment />
        <BuiltOnMezo />
        <Faq />
      </main>

      <Footer />
    </div>
  );
}
