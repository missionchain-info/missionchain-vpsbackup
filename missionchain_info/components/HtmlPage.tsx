'use client';

import { useEffect, useRef } from 'react';

interface HtmlPageProps {
  styles: string;
  body: string;
  fonts: string;
}

export default function HtmlPage({ styles, body, fonts }: HtmlPageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const scriptsRan = useRef(false);

  useEffect(() => {
    if (!containerRef.current || scriptsRan.current) return;
    scriptsRan.current = true;

    // Find and execute inline scripts as real <script> elements
    const inlineScripts = containerRef.current.querySelectorAll('script');
    inlineScripts.forEach(oldScript => {
      const newScript = document.createElement('script');
      if (oldScript.src) {
        newScript.src = oldScript.src;
      } else {
        newScript.textContent = oldScript.textContent;
      }
      oldScript.parentNode?.removeChild(oldScript);
      document.body.appendChild(newScript);
    });
  }, [body]);

  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: fonts }} style={{ display: 'none' }} />
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <div ref={containerRef} dangerouslySetInnerHTML={{ __html: body }} />
    </>
  );
}
