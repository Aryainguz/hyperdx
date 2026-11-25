import request from 'supertest';
import { gzipSync } from 'zlib';

import * as userController from '@/controllers/user';
import { getAgent, getLoggedInAgent, getServer } from '@/fixtures';
import { ANONYMOUS_BODY_LIMIT_BYTES } from '@/middleware/bodyParser';

const padding = 'x'.repeat(2 * ANONYMOUS_BODY_LIMIT_BYTES);
const largeDashboard = { name: 'd', tiles: [], tags: [], padding };

describe('request body limits', () => {
  const server = getServer();

  beforeAll(async () => {
    await server.start();
  });

  afterEach(async () => {
    await server.clearDBs();
  });

  afterAll(async () => {
    await server.stop();
  });

  describe('anonymous callers', () => {
    it('rejects a large login body', async () => {
      const res = await getAgent(server)
        .post('/login/password')
        .type('form')
        .send({ email: 'a@example.com', password: padding });
      expect(res.status).toBe(413);
    });

    it('rejects a large body on a session route', async () => {
      const res = await getAgent(server)
        .post('/dashboards')
        .send(largeDashboard);
      expect(res.status).toBe(413);
    });

    it('rejects a large chunked body, which has no Content-Length', async () => {
      const req = getAgent(server)
        .post('/dashboards')
        .set('Content-Type', 'application/json');
      req.write(JSON.stringify(largeDashboard));
      const res = await req;
      expect(res.status).toBe(413);
    });

    it('rejects a large body sent with an unknown API key', async () => {
      const res = await request(server.getHttpServer())
        .post('/api/v2/dashboards')
        .set('Authorization', 'Bearer not-a-real-key')
        .send(largeDashboard);
      expect(res.status).toBe(413);
    });

    it('still accepts a normal login body', async () => {
      const res = await getAgent(server)
        .post('/login/password')
        .type('form')
        .send({ email: 'a@example.com', password: 'wrong-password' });
      expect(res.status).toBe(303);
      expect(res.headers.location).toContain('/login?err=authFail');
    });
  });

  describe('authenticated callers', () => {
    it('accepts a large body with a session', async () => {
      const { agent } = await getLoggedInAgent(server);
      const res = await agent.post('/dashboards').send(largeDashboard);
      expect(res.status).toBe(200);
    });

    it('accepts a gzipped body that is small on the wire but large decoded', async () => {
      const { agent } = await getLoggedInAgent(server);
      const compressed = gzipSync(JSON.stringify(largeDashboard));
      expect(compressed.length).toBeLessThan(ANONYMOUS_BODY_LIMIT_BYTES);
      // write(), not send(): superagent would JSON-encode a Buffer.
      const req = agent
        .post('/dashboards')
        .set('Content-Type', 'application/json')
        .set('Content-Encoding', 'gzip')
        .set('Content-Length', String(compressed.length));
      req.write(compressed);
      const res = await req;
      expect(res.status).toBe(200);
    });

    it('accepts a large body with a valid API key, looking the key up once', async () => {
      const { user } = await getLoggedInAgent(server);
      const lookup = jest.spyOn(userController, 'findUserByAccessKey');
      try {
        const res = await request(server.getHttpServer())
          .post('/api/v2/dashboards')
          .set('Authorization', `Bearer ${user.accessKey}`)
          .send(largeDashboard);
        expect(res.status).toBe(200);
        expect(lookup).toHaveBeenCalledTimes(1);
      } finally {
        lookup.mockRestore();
      }
    });
  });
});
