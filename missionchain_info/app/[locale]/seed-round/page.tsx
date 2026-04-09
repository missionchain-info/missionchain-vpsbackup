import { loadHtmlPage, isValidLocale } from '@/lib/loadHtmlContent';
import HtmlPage from '@/components/HtmlPage';
import { notFound } from 'next/navigation';

export default function LocaleSeedRoundPage({ params }: { params: { locale: string } }) {
  if (!isValidLocale(params.locale) || params.locale === 'en') notFound();
  const { styles, body, fonts } = loadHtmlPage('mc_seed_round.html', params.locale);
  return <HtmlPage styles={styles} body={body} fonts={fonts} />;
}
