import { loadHtmlPage } from '@/lib/loadHtmlContent';
import HtmlPage from '@/components/HtmlPage';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'White Paper — Mission Chain',
};

export default function WhitepaperPage() {
  const { styles, body, fonts } = loadHtmlPage('mc_white_paper.html');
  return <HtmlPage styles={styles} body={body} fonts={fonts} />;
}
