import { handleApi } from '../../../server/api.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(request, context) {
  const { path } = await context.params;
  return handleApi(request, path.join('/'));
}

export { handle as GET, handle as POST, handle as PUT, handle as DELETE, handle as PATCH };
