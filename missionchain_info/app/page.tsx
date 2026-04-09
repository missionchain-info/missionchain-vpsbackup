import { loadHtmlPage } from '@/lib/loadHtmlContent';
import HtmlPage from '@/components/HtmlPage';

export default function HomePage() {
  const { styles, body, fonts } = loadHtmlPage('index.html');
  return <HtmlPage styles={styles} body={body} fonts={fonts} />;
}
