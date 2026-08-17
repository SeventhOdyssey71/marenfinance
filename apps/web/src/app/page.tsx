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
      {/* The "Skip to content" link was removed here on the owner's direct instruction.
          It is a real accessibility affordance and its absence is a real cost: a keyboard
          user now tabs the four nav links and the CTA before reaching the hero. Restoring
          it is one element — an <a href="#main"> with `sr-only focus:not-sr-only`, placed
          immediately inside this fragment, above <Nav />. */}
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
