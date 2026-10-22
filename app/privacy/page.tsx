import type { Metadata } from 'next';
import { LegalPage, Contact } from '@/components/LegalPage';
import { APP_NAME } from '@/lib/app-config';

export const metadata: Metadata = { title: `Privacy · ${APP_NAME}` };

export default function Privacy() {
  return (
    <LegalPage title="Privacy" updated="October 2026">
      <p>{APP_NAME} helps you price and describe items you sell. This page explains what we keep and why, in plain words.</p>

      <h2>What we keep</h2>
      <ul>
        <li><strong>Your Google account basics:</strong> your name, email address and profile picture, so you can sign in.</li>
        <li><strong>Your photos:</strong> the photos you upload of items you&apos;re selling.</li>
        <li><strong>Your listings:</strong> the titles, descriptions, prices and Depop details we create, plus any edits you make.</li>
        <li><strong>Your settings:</strong> location, currency and shipping prices.</li>
        <li><strong>Usage counts:</strong> how many listings you&apos;ve made this month, to apply the free limit, and whether you&apos;ve asked for a higher limit.</li>
        <li><strong>How each listing was made:</strong> what the AI read from your photos, the matching sales it found and what it cost to run. This is used to fix problems and improve pricing.</li>
      </ul>

      <h2>How your photos are used</h2>
      <p>To read your item and find matching sales, your photos are sent to Google&apos;s Gemini AI and to eBay&apos;s image search. They are used only to create your listing. We don&apos;t sell your data or use it for advertising.</p>

      <h2>How long we keep things</h2>
      <ul>
        <li>Photos are deleted automatically 30 days after you export the item to a CSV, or 90 days after upload if you never export it.</li>
        <li>Deleting an item removes it and its photos straight away.</li>
        <li>Your listing text stays until you delete it, so your history is there when you come back.</li>
      </ul>

      <h2>Who else is involved</h2>
      <p>{APP_NAME} runs on Vercel (hosting) and Supabase (sign-in, database and photo storage). Google provides sign-in and the AI. eBay provides sales data. Each handles data under its own privacy policy.</p>

      <h2>Deleting your account</h2>
      <p>To delete your account and everything in it, email <Contact /> from the address you sign in with.</p>
    </LegalPage>
  );
}
