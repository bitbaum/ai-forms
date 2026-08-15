import { resolveComplete } from '@/lib/complete';

/** Lets the page tell the visitor honestly which engine is answering. */
export function GET() {
  const { mode, model } = resolveComplete();
  return Response.json({ mode, model });
}
