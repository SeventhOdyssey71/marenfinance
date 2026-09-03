import './landing.css';

import { Nav } from '@/components/nav';
import { Hero } from '@/components/hero';
import { Surfaces } from '@/components/surfaces';
import { HowItWorks } from '@/components/how-it-works';
import { Faq } from '@/components/faq';
import { Footer } from '@/components/footer';
import { ScrollProgress } from '@/components/landing/scroll-progress';

/** Real in-page anchors for the floating scroll-progress indicator. */
const PROGRESS_SECTIONS = [
  { id: 'product', label: 'Product' },
  { id: 'how', label: 'How it works' },
  { id: 'faq', label: 'FAQ' },
];

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
        <Surfaces />
        <HowItWorks />
        <Faq />
      </main>

      <Footer />

      <ScrollProgress sections={PROGRESS_SECTIONS} />
    </div>
  );
}
