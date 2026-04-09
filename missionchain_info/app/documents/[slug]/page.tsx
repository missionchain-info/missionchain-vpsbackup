import { loadHtmlPage } from '@/lib/loadHtmlContent';
import HtmlPage from '@/components/HtmlPage';
import fs from 'fs';
import path from 'path';

const DOCS_DIR = '/var/www/missionchain-info/frontend/documents';

export function generateStaticParams() {
  if (!fs.existsSync(DOCS_DIR)) return [];
  return fs.readdirSync(DOCS_DIR)
    .filter(f => f.endsWith('.html') && f !== 'documents-index.html')
    .map(f => ({ slug: f.replace('.html', '') }));
}

export default function DocumentPage({ params }: { params: { slug: string } }) {
  const { styles, body, fonts } = loadHtmlPage(`frontend/documents/${params.slug}.html`);
  return <HtmlPage styles={styles} body={body} fonts={fonts} />;
}
