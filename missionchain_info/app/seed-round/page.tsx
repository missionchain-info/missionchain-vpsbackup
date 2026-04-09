import { loadHtmlPage } from '@/lib/loadHtmlContent';
import HtmlPage from '@/components/HtmlPage';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'SEED Round — Mission Chain',
};

export default function SeedRoundPage() {
  const { styles, body, fonts } = loadHtmlPage('mc_seed_round.html');
  return <HtmlPage styles={styles} body={body} fonts={fonts} />;
}
