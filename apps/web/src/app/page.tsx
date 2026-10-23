import './landing.css';

import { Nav } from '@/components/nav';
import { Hero } from '@/components/hero';
import { HowItWorks } from '@/components/how-it-works';
import { Facts } from '@/components/landing/facts';
import { Faq } from '@/components/faq';
import { Closing } from '@/components/landing/closing';
import { Footer } from '@/components/footer';

/**
 * The Maren landing, on the shared light system (apps/web/DESIGN.md): Neue Montreal
 * throughout, white page, violet only on the action. Hero, three steps, four facts,
 * the risk FAQ, one closing call to action, footer.
 */
export default function HomePage() {
  return (
    <>
      <a
        href="#main"
        className="bg-ink fixed left-4 top-2 z-[100] -translate-y-[160%] px-5 py-3 text-[0.9375rem] font-medium text-white focus:translate-y-0"
      >
        Skip to content
      </a>
      <Nav />

      <main id="main" tabIndex={-1} className="focus:outline-none">
        <Hero />
        <HowItWorks />
        <Facts />
        <Faq />
        <Closing />
      </main>

      <Footer />
    </>
  );
}
