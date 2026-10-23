import type { NextApiRequest, NextApiResponse } from 'next';
import { components } from '@/common';
import {
  requestIsNativeService,
  requestKailoUser,
} from '@server/services/kailoUserService';

// DD-133(4): the caller's own member directory entry, for the middleware's
// page/GraphQL/REST admission. The user comes only from the header the
// middleware set after verifying the token; the answer carries nothing but
// that user's own membership and role.
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
  }
  const user = requestKailoUser(req.headers);
  if (!user || requestIsNativeService(req.headers))
    return res.status(401).json({ error: 'NATIVE_AUTHENTICATION_REQUIRED' });
  const directory = components.kailoMemberDirectory;
  if (!directory)
    return res.status(503).json({ error: 'NATIVE_INSTANCE_UNAVAILABLE' });
  try {
    const access = await directory.access(user.key);
    return res.status(200).json({ userKey: user.key, ...access });
  } catch {
    return res.status(503).json({ error: 'NATIVE_INSTANCE_UNAVAILABLE' });
  }
}
