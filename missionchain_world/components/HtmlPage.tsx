'use client';

import { useEffect, useRef } from 'react';

interface HtmlPageProps {
  styles: string;
  body: string;
  fonts: string;
  scripts: string;
}

export default function HtmlPage({ styles, body, fonts, scripts }: HtmlPageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scriptsRan = useRef(false);

  useEffect(() => {
    if (!containerRef.current || scriptsRan.current) return;
    scriptsRan.current = true;

    // Inject scripts as real <script> elements so functions are in global scope
    if (scripts) {
      const scriptEl = document.createElement('script');
      scriptEl.textContent = scripts;
      document.body.appendChild(scriptEl);
    }
  }, [scripts]);

  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: fonts }} style={{ display: 'none' }} />
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <div ref={containerRef} dangerouslySetInnerHTML={{ __html: body }} />
    </>
  );
}
