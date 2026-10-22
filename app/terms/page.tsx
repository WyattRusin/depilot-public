import type { Metadata } from 'next';
import { LegalPage, Contact } from '@/components/LegalPage';
import { APP_NAME } from '@/lib/app-config';

export const metadata: Metadata = { title: `Terms · ${APP_NAME}` };

export default function Terms() {
  return (
    <LegalPage title="Terms" updated="October 2026">
      <p>By using {APP_NAME} you agree to these terms. They&apos;re short.</p>

      <h2>The service</h2>
      <p>{APP_NAME} is free to use. It suggests prices and writes descriptions for items you sell. It isn&apos;t affiliated with Depop, eBay or Google.</p>

      <h2>Prices and descriptions are suggestions</h2>
      <p>Prices come from recent sales of similar items, and descriptions are written by AI from your photos. Both can be wrong. Check every listing before you post it, including the brand, size, era and condition. You&apos;re responsible for what you list and for following Depop&apos;s rules.</p>

      <h2>Fair use</h2>
      <ul>
        <li>Each account can create up to 50 listings a month. If you need more, email <Contact />.</li>
        <li>Only upload photos you have the right to use, of items you&apos;re selling.</li>
        <li>Don&apos;t try to get around the limits, overload the service or use it for anything unlawful.</li>
      </ul>
      <p>If the monthly running budget is used up, new listings pause until the 1st. Everything you&apos;ve made stays editable and exportable.</p>

      <h2>Changes</h2>
      <p>{APP_NAME} may change, pause or end at any time. We may suspend accounts that misuse it.</p>

      <h2>No warranty</h2>
      <p>{APP_NAME} is provided as is, without warranties of any kind. To the extent the law allows, we aren&apos;t liable for losses from using it, including sales made at a suggested price.</p>

      <h2>Contact</h2>
      <p>Questions? Email <Contact />.</p>
    </LegalPage>
  );
}
