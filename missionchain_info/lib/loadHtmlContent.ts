import fs from 'fs';
import path from 'path';

const CONTENT_DIR = '/var/www/missionchain-info';

export interface PageContent {
  styles: string;
  body: string;
  title: string;
  fonts: string;
}

export function loadHtmlPage(filename: string, locale?: string): PageContent {
  let filePath: string;

  if (locale && locale !== 'en') {
    filePath = path.join(CONTENT_DIR, 'translations', locale, filename);
    if (!fs.existsSync(filePath)) {
      filePath = path.join(CONTENT_DIR, filename);
    }
  } else {
    filePath = path.join(CONTENT_DIR, filename);
  }

  const html = fs.readFileSync(filePath, 'utf-8');

  // Extract <style> content
  const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
  const styles = styleMatch ? styleMatch[1] : '';

  // Extract font links
  const fontMatches = html.match(/<link[^>]*fonts\.googleapis\.com[^>]*>/g);
  const fonts = fontMatches ? fontMatches.join('\n') : '';

  // Extract <title>
  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/);
  const title = titleMatch ? titleMatch[1] : 'Mission Chain';

  // Extract <body> content (everything between <body> and </body>)
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*?)<\/body>/);
  let body = bodyMatch ? bodyMatch[1] : '';

  // Fix image paths — replace base64 logos with file reference
  body = body.replace(
    /src="data:image\/png;base64,[^"]{100,}"/g,
    'src="/images/mission-chain-logo-clear.png"'
  );

  // Fix relative image paths
  body = body.replace(/src="mission-chain-logo-clear\.png"/g, 'src="/images/mission-chain-logo-clear.png"');
  body = body.replace(/src="mission-chain-logo-hd\.png"/g, 'src="/images/mission-chain-logo-hd.png"');
  body = body.replace(/src="mr-thomas-l\.png"/g, 'src="/images/mr-thomas-l.png"');

  // Extract scripts
  const scriptMatches = html.match(/<script>([\s\S]*?)<\/script>/g);
  const scripts = scriptMatches
    ? scriptMatches.map(s => s.replace(/<\/?script>/g, '')).join('\n')
    : '';

  // Append scripts as inline script in body
  if (scripts) {
    body += `<script>${scripts}</script>`;
  }

  return { styles, body, title, fonts };
}

export function loadDocumentPage(slug: string): PageContent {
  const filePath = path.join(CONTENT_DIR, 'frontend', 'documents', `${slug}.html`);
  if (!fs.existsSync(filePath)) {
    return { styles: '', body: '<h1>Document not found</h1>', title: 'Not Found', fonts: '' };
  }
  return loadHtmlPage(path.join('frontend', 'documents', `${slug}.html`));
}

export function getAvailableDocuments(): string[] {
  const docsDir = path.join(CONTENT_DIR, 'frontend', 'documents');
  return fs.readdirSync(docsDir)
    .filter(f => f.endsWith('.html'))
    .map(f => f.replace('.html', ''));
}

export const SUPPORTED_LOCALES = ['en', 'es', 'pt', 'ko', 'vi'] as const;
export type Locale = typeof SUPPORTED_LOCALES[number];

export function isValidLocale(locale: string): locale is Locale {
  return SUPPORTED_LOCALES.includes(locale as Locale);
}
