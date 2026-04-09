import { loadWorldPage } from '@/lib/loadHtmlContent';
import HtmlPage from '@/components/HtmlPage';

export default function HomePage() {
  const { styles, body, fonts, scripts } = loadWorldPage();
  return <HtmlPage styles={styles} body={body} fonts={fonts} scripts={scripts} />;
}
