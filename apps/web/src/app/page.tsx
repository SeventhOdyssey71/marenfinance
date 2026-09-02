import './landing.css';

import { Nav } from '@/components/nav';
import { Hero } from '@/components/hero';
import { Ribbon } from '@/components/ribbon';
import { Surfaces } from '@/components/surfaces';
import { HowItWorks } from '@/components/how-it-works';
import { BuiltOnMezo } from '@/components/built-on-mezo';
import { Faq } from '@/components/faq';
import { Footer } from '@/components/footer';

/**
 * Maren marketing landing — the "UGLYCASH" sticker-brutalist page: a paper-cream
 * canvas where a 1px black border structures every card, button and panel, loud
 * Anton headlines over Inter body, saturated sticker fills, and no drop shadows.
 *
 * The whole page is scoped under `.landing`, which paints the paper canvas and
 * re-derives the shared text/border tokens for it — so nothing here touches the
 * dark /app or /docs, or the @theme tokens they depend on.
 *
 * Every figure on the CSS app mocks is tagged "Illustrative"; every stat is a
 * Maren / Mezo protocol fact. No invented traction, users or volume.
 */
export default function HomePage() {
  return (
    <div className="landing">
      <Nav />

      <main id="main">
        <Hero />
        <Ribbon />
        <Surfaces />
        <HowItWorks />
        <BuiltOnMezo />
        <Faq />
      </main>

      <Footer />
    </div>
  );
}
