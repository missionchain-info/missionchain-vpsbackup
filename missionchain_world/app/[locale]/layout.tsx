import { isValidLocale } from '@/lib/loadHtmlContent';
import { notFound } from 'next/navigation';

export default function LocaleLayout({ children, params }: { children: React.ReactNode; params: { locale: string } }) {
  if (!isValidLocale(params.locale) || params.locale === 'en') {
    notFound();
  }
  return children;
}
