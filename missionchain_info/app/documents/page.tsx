import { loadHtmlPage } from '@/lib/loadHtmlContent';
import HtmlPage from '@/components/HtmlPage';

export default function DocumentsIndexPage() {
  const { styles, body, fonts } = loadHtmlPage('frontend/documents/documents-index.html');
  return <HtmlPage styles={styles} body={body} fonts={fonts} />;
}
