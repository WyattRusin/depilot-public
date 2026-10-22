import { APP_LINKS } from '@/lib/app-config';
import { Footer } from './Footer';
import { Wordmark } from './Logo';

export function LegalPage({ title, updated, children }: { title: string; updated: string; children: React.ReactNode }) {
  return (
    <div className="app">
      <header className="top"><Wordmark /></header>
      <div className="legal-page">
        <main className="legal-body">
          <h1>{title}</h1>
          <p className="legal-updated">Last updated {updated}</p>
          {children}
        </main>
        <Footer />
      </div>
    </div>
  );
}

export function Contact() {
  if (APP_LINKS.contactEmail) return <a href={`mailto:${APP_LINKS.contactEmail}`}>{APP_LINKS.contactEmail}</a>;
  return <>a message through our <a href={APP_LINKS.coffee} target="_blank" rel="noopener noreferrer">Buy Me a Coffee page</a></>;
}
