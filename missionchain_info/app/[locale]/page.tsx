import { loadHtmlPage, SUPPORTED_LOCALES } from '@/lib/loadHtmlContent';
import HtmlPage from '@/components/HtmlPage';

export function generateStaticParams() {
  return SUPPORTED_LOCALES.filter(l => l !== 'en').map(locale => ({ locale }));
}

export default function LocaleHomePage({ params }: { params: { locale: string } }) {
  const { styles, body, fonts } = loadHtmlPage('index.html', params.locale);
  return <HtmlPage styles={styles} body={body} fonts={fonts} />;
}
