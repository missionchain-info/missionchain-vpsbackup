import { loadWorldPage, isValidLocale, SUPPORTED_LOCALES } from '@/lib/loadHtmlContent';
import HtmlPage from '@/components/HtmlPage';
import { notFound } from 'next/navigation';

export function generateStaticParams() {
  return SUPPORTED_LOCALES.filter(l => l !== 'en').map(locale => ({ locale }));
}

export default function LocaleHomePage({ params }: { params: { locale: string } }) {
  if (!isValidLocale(params.locale) || params.locale === 'en') {
    notFound();
  }
  const { styles, body, fonts, scripts } = loadWorldPage(params.locale);
  // Add script to set the lang dropdown to current locale
  const localeScript = scripts + `\n;(function(){var s=document.getElementById('lang-sel');if(s)s.value='${params.locale}';})();\n`;
  return <HtmlPage styles={styles} body={body} fonts={fonts} scripts={localeScript} />;
}
