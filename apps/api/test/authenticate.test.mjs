import assert from "node:assert/strict";
import test from "node:test";
import jwt from "jsonwebtoken";
import { authenticate } from "../dist/middleware/authenticate.js";
import { env } from "../dist/config/env.js";

function requestWith(token) {
  return { cookies: { recallio_session: token }, userId: undefined };
}

async function runMiddleware(req) {
  let error;
  await authenticate(req, {}, (nextError) => { error = nextError; });
  return error;
}

test("accepts Recallio HS256 sessions with the expected issuer", async () => {
  const token = jwt.sign({}, env.JWT_SECRET, { subject: "user-123", issuer: "recallio", expiresIn: "1h" });
  const req = requestWith(token);
  assert.equal(await runMiddleware(req), undefined);
  assert.equal(req.userId, "user-123");
});

test("rejects a correctly signed session token from another issuer", async () => {
  const token = jwt.sign({}, env.JWT_SECRET, { subject: "user-123", issuer: "other-app", expiresIn: "1h" });
  const error = await runMiddleware(requestWith(token));
  assert.equal(error?.status, 401);
  assert.equal(error?.code, "UNAUTHENTICATED");
});
