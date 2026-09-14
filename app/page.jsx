import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import ApplicationRuntime from '@/components/ApplicationRuntime';

function applicationMarkup() {
  const document = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
  const body = document.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? '';
  return body.replace(/<script\b[^>]*src=["'][^"']*portal\.js[^"']*["'][^>]*><\/script>/gi, '');
}

export default function HomePage() {
  return <ApplicationRuntime markup={applicationMarkup()} />;
}
