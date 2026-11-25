import express, { NextFunction, Request, Response } from 'express';

import * as config from '@/config';
import { findAccessKeyUser } from '@/middleware/auth';
import { captureProxyBody } from '@/utils/proxyBody';

// Large queries and dashboards go through the ClickHouse proxy, MCP and the
// external API, all of which require auth.
const AUTHENTICATED_BODY_LIMIT = '32mb';
// Anonymous callers can only reach login, registration and invite setup.
export const ANONYMOUS_BODY_LIMIT_BYTES = 100 * 1024;

const bodyParsers = (limit: string | number) =>
  express
    .Router()
    .use(
      express.json({ limit, verify: captureProxyBody }),
      express.text({ limit, verify: captureProxyBody }),
      express.urlencoded({ extended: false, limit, verify: captureProxyBody }),
    );

const authenticatedBodyParsers = bodyParsers(AUTHENTICATED_BODY_LIMIT);
const anonymousBodyParsers = bodyParsers(ANONYMOUS_BODY_LIMIT_BYTES);

// The limit applies to the decoded body, so a compressed or chunked body can
// exceed it whatever Content-Length says.
const mayExceedAnonymousLimit = (req: Request) => {
  const encoding = req.headers['content-encoding'];
  return (
    req.headers['transfer-encoding'] != null ||
    (encoding != null && encoding !== 'identity') ||
    Number(req.headers['content-length'] ?? 0) > ANONYMOUS_BODY_LIMIT_BYTES
  );
};

const isKnownCaller = async (req: Request) =>
  config.IS_LOCAL_APP_MODE ||
  req.isAuthenticated?.() === true ||
  (await findAccessKeyUser(req)) != null;

/**
 * Parses request bodies with a limit that depends on the caller, so a client
 * with no session or API key can't make the API buffer and parse 32 MB
 * before the route rejects it. Only bodies that may be over the anonymous
 * limit pay for the caller check; the anonymous parsers enforce that limit
 * either way. Must run after passport.session().
 */
export async function parseRequestBody(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  let known = false;
  if (mayExceedAnonymousLimit(req)) {
    try {
      known = await isKnownCaller(req);
    } catch (err) {
      return next(err);
    }
  }
  const parsers = known ? authenticatedBodyParsers : anonymousBodyParsers;
  parsers(req, res, next);
}
