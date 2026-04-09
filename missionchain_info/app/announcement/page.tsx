import { loadHtmlPage } from '@/lib/loadHtmlContent';
import HtmlPage from '@/components/HtmlPage';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Smart Contract Migration — Mission Chain',
};

export default function AnnouncementPage() {
  const { styles, body, fonts } = loadHtmlPage('mc_announcement.html');
  return <HtmlPage styles={styles} body={body} fonts={fonts} />;
}
