import fs from 'fs';
import path from 'path';

export interface PageContent {
  styles: string;
  body: string;
  title: string;
  fonts: string;
  scripts: string;
}

export const SUPPORTED_LOCALES = ['en', 'es', 'pt', 'ko', 'vi'] as const;
export type Locale = typeof SUPPORTED_LOCALES[number];

export function isValidLocale(locale: string): locale is Locale {
  return SUPPORTED_LOCALES.includes(locale as Locale);
}

export function loadWorldPage(locale?: string): PageContent {
  let filePath: string;

  if (locale && locale !== 'en') {
    const localePath = path.join(process.cwd(), 'content', 'translations', locale, 'index.html');
    if (fs.existsSync(localePath)) {
      filePath = localePath;
    } else {
      filePath = path.join(process.cwd(), 'content', 'index.html');
    }
  } else {
    filePath = path.join(process.cwd(), 'content', 'index.html');
  }

  const html = fs.readFileSync(filePath, 'utf-8');

  // Extract ALL <style> blocks
  const styleMatches = html.match(/<style>([\s\S]*?)<\/style>/g);
  const styles = styleMatches
    ? styleMatches.map(s => s.replace(/<\/?style>/g, '')).join('\n')
    : '';

  // Extract font links
  const fontMatches = html.match(/<link[^>]*fonts\.googleapis\.com[^>]*>/g);
  const fonts = fontMatches ? fontMatches.join('\n') : '';

  // Extract <title>
  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/);
  const title = titleMatch ? titleMatch[1] : 'Mission Chain World';

  // Extract <body> content
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/);
  let body = bodyMatch ? bodyMatch[1] : '';

  // Remove inline <script> tags from body
  const scriptBlocks: string[] = [];
  body = body.replace(/<script>([\s\S]*?)<\/script>/g, (_match, code) => {
    scriptBlocks.push(code);
    return '';
  });

  const scripts = scriptBlocks.join('\n');

  // Fix image paths
  body = body.replace(
    /src="https:\/\/missionchain\.io\/mission-chain-logo-clear\.png"/g,
    'src="/images/mission-chain-logo-clear.png"'
  );

  // Override setLang to navigate to locale URL
  const langOverride = `
;(function(){
  window.setLang = function(l) {
    if (l === 'en') {
      window.location.href = '/';
    } else {
      window.location.href = '/' + l;
    }
  };
})();
`;
  const allScripts = scripts + langOverride;

  return { styles, body, title, fonts, scripts: allScripts };
}
