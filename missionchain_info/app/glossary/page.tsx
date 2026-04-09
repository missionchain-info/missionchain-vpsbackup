import { loadHtmlPage } from '@/lib/loadHtmlContent';
import HtmlPage from '@/components/HtmlPage';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Glossary & Brand Terms — Mission Chain',
};

export default function GlossaryPage() {
  const { styles, body, fonts } = loadHtmlPage('Glossary_Brand_Terms.html');
  return <HtmlPage styles={styles} body={body} fonts={fonts} />;
}
