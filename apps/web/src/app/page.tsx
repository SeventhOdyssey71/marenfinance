import { Nav } from '@/components/nav';
import { Hero } from '@/components/hero';
import { Problem } from '@/components/problem';
import { Frictions } from '@/components/frictions';
import { HowItWorks } from '@/components/how-it-works';
import { Surfaces } from '@/components/surfaces';
import { BuiltOnMezo } from '@/components/built-on-mezo';
import { Faq } from '@/components/faq';
import { CtaBand } from '@/components/cta-band';
import { Footer } from '@/components/footer';

export default function HomePage() {
  return (
    <>
      <a
        href="#main"
        className="sr-only rounded-[var(--radius-pill)] bg-white px-5 py-3 text-sm font-medium text-[#08080A] focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60]"
      >
        Skip to content
      </a>

      <Nav />

      <main id="main">
        <Hero />
        <Problem />
        <Frictions />
        <HowItWorks />
        <Surfaces />
        <BuiltOnMezo />
        <Faq />
        <CtaBand />
      </main>

      <Footer />
    </>
  );
}
