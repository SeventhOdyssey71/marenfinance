import './landing.css';

import { Nav } from '@/components/nav';
import { Hero } from '@/components/hero';
import { Showcase } from '@/components/showcase';
import { HowItWorks } from '@/components/how-it-works';
import { Faq } from '@/components/faq';
import { Footer } from '@/components/footer';
import { ScrollProgress } from '@/components/landing/scroll-progress';

/** Real in-page anchors for the floating scroll-progress indicator. */
const PROGRESS_SECTIONS = [
  { id: 'product', label: 'Product' },
  { id: 'faq', label: 'FAQ' },
];

/**
 * Maren marketing landing — clean and minimal: a near-white canvas, SF Pro Rounded
 * display over Neue Montreal body, black + white with the Maren violet as the one
 * accent. Hero → a real-screenshot showcase → the awkward-questions FAQ → footer.
 * Scoped under `.landing` so it never touches the /app or /docs themes.
 */
export default function HomePage() {
  return (
    <div className="landing">
      <a href="#main" className="landing-skip">
        Skip to content
      </a>
      <Nav />

      <main id="main" tabIndex={-1}>
        <Hero />
        <Showcase />
        <HowItWorks />
        <Faq />
      </main>

      <Footer />

      <ScrollProgress sections={PROGRESS_SECTIONS} />
    </div>
  );
}
