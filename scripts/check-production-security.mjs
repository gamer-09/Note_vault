import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../dist/index.html', import.meta.url), 'utf8');
const cspMatch = html.match(/<meta\b(?=[^>]*http-equiv="Content-Security-Policy")[^>]*>/i);
if (!cspMatch) throw new Error('Production build is missing the Content Security Policy meta tag.');

const cspIndex = html.indexOf(cspMatch[0]);
const firstScriptIndex = html.search(/<script\b/i);
if (firstScriptIndex === -1 || cspIndex > firstScriptIndex) {
  throw new Error('The production CSP must appear before script tags.');
}
const scriptTags = [...html.matchAll(/<script\b([^>]*)>/gi)];
if (scriptTags.some(([, attributes]) => !/\bsrc=/i.test(attributes))) {
  throw new Error('Inline scripts are not allowed by the production CSP.');
}

const contentMatch = cspMatch[0].match(/\bcontent="([^"]*)"/i);
if (!contentMatch) throw new Error('The production CSP meta tag has no content.');
const policy = contentMatch[1]
  .replaceAll('&#39;', "'")
  .replaceAll('&quot;', '"')
  .replaceAll('&amp;', '&');

const requiredDirectives = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  'frame-src blob:',
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
];
for (const directive of requiredDirectives) {
  if (!policy.includes(directive)) throw new Error(`Production CSP is missing: ${directive}`);
}
if (/unsafe-(?:inline|eval)|https?:\/\//i.test(policy)) {
  throw new Error('Production CSP contains an unsafe or remote source.');
}
if (!/name="referrer"\s+content="no-referrer"/i.test(html)) {
  throw new Error('Production build is missing the no-referrer policy.');
}

console.log('Production security policy verified.');
