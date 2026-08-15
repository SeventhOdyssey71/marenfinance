import Link from 'next/link';
import { Wordmark } from './ui/wordmark';
import { XLogo, GitHubLogo } from './ui/icons';

const columns = [
  {
    heading: 'Product',
    links: [
      { label: 'Vault', href: '#product' },
      { label: 'Pay', href: '#product' },
      { label: 'Earn', href: '#product' },
      { label: 'Portfolio', href: '#product' },
    ],
  },
  {
    heading: 'Learn',
    links: [
      { label: 'The problem', href: '#problem' },
      { label: 'How it works', href: '#how-it-works' },
      { label: 'Built on Mezo', href: '#mezo' },
      { label: 'FAQ', href: '#faq' },
    ],
  },
  {
    heading: 'Network',
    links: [
      { label: 'Mezo Explorer', href: 'https://explorer.mezo.org', external: true },
      { label: 'mezo.org', href: 'https://mezo.org', external: true },
      { label: 'Mezo docs', href: 'https://info.mezo.org', external: true },
    ],
  },
] as const;

const socials = [
  {
    label: 'Maren on X',
    href: 'https://x.com/marenfinance',
    Icon: XLogo,
  },
  {
    label: 'Maren on GitHub',
    href: 'https://github.com/SeventhOdyssey71/marenfinance',
    Icon: GitHubLogo,
  },
] as const;

export function Footer() {
  return (
    <footer className="hairline-t">
      <div className="container-maren">
        <div className="grid grid-cols-1 gap-12 py-16 md:grid-cols-12 md:gap-8 md:py-24">
          <div className="md:col-span-5 lg:col-span-4">
            <Wordmark className="h-[18px] w-auto text-text" />
            <p className="mt-6 max-w-xs text-sm leading-relaxed text-text-muted">
              Bitcoin liquidity, gasless spending, and yield. Built on Mezo.
            </p>
            <ul className="mt-8 flex items-center gap-2">
              {socials.map(({ label, href, Icon }) => (
                <li key={label}>
                  <a
                    href={href}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label={label}
                    className="grid size-11 place-items-center rounded-[var(--radius-pill)] border border-[var(--border-hairline)] bg-surface text-text-muted transition-colors duration-[120ms] ease-out hover:border-[var(--border-strong)] hover:text-text"
                  >
                    <Icon className="size-4" />
                  </a>
                </li>
              ))}
            </ul>
          </div>

          <nav
            aria-label="Footer"
            className="grid grid-cols-2 gap-8 sm:grid-cols-3 md:col-span-7 md:col-start-6"
          >
            {columns.map((col) => (
              <div key={col.heading}>
                <h2 className="t-label text-text-subtle">{col.heading}</h2>
                <ul className="mt-5 space-y-3.5">
                  {col.links.map((l) => (
                    <li key={l.label}>
                      {'external' in l && l.external ? (
                        <a
                          href={l.href}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-sm text-text-muted transition-colors duration-[120ms] ease-out hover:text-text"
                        >
                          {l.label}
                        </a>
                      ) : (
                        <Link
                          href={l.href}
                          className="text-sm text-text-muted transition-colors duration-[120ms] ease-out hover:text-text"
                        >
                          {l.label}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className="hairline-t flex flex-col-reverse gap-4 py-8 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-text-subtle">
            © {new Date().getFullYear()} Maren Finance. Pre-audit software — deposit only
            what you can afford to lose.
          </p>
          <p className="inline-flex items-center gap-2.5 text-xs text-text-subtle">
            <span aria-hidden className="size-1.5 rounded-full bg-violet-500" />
            Built on Mezo
            <span className="num text-text-subtle/70">31612 · 31611</span>
          </p>
        </div>
      </div>
    </footer>
  );
}
