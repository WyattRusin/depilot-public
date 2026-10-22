import Link from 'next/link';
import { APP_LINKS } from '@/lib/app-config';

export function Footer() {
  return (
    <footer className="site-foot">
      <span>Depilot</span>
      <nav>
        <Link href="/privacy">Privacy</Link>
        <Link href="/terms">Terms</Link>
        {APP_LINKS.contactEmail && <a href={`mailto:${APP_LINKS.contactEmail}`}>Contact</a>}
        {APP_LINKS.coffee && <a href={APP_LINKS.coffee} target="_blank" rel="noopener noreferrer">Buy me a coffee</a>}
      </nav>
    </footer>
  );
}
