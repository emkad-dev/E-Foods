/// <reference path="../_shared/edge-runtime.d.ts" />

import { corsHeaders } from '../_shared/cors.ts';
import { getBearerToken, verifySupabaseJwt } from '../_shared/auth.ts';
import {
  ClientSafeError, clientErrorMessage, createEdgeObservation,
  finishEdgeObservation, getErrorStatus, jsonResponse, logEdgeEvent,
} from '../_shared/observability.ts';
import { validateEmail, validatePassword } from '../_shared/validation.ts';
import { parseRoute, clientIp } from './router.ts';
import { safeAuthMessage } from './errors.ts';
import { enforceRateLimit, POLICIES } from './ratelimit.ts';
import { writeAudit } from './audit.ts';
import { gotrue } from './gotrue.ts';
import { parseOtpChannel, parseOtpPhone, requestOtp, verifyOtp } from './otp.ts';

const respond = (status: number, body: unknown) =>
  jsonResponse(status, body, corsHeaders);

Deno.serve(async (request) => {
  const observation = createEdgeObservation(request, 'auth-gateway');
  let capturedError: unknown = null;
  let response: Response;

  if (request.method === 'OPTIONS') {
    response = new Response(null, { headers: corsHeaders, status: 204 });
    finishEdgeObservation(observation, { status: 204 });
    return response;
  }

  const ip = clientIp(request);
  const route = parseRoute(request.url);
  observation.action = route ?? undefined;

  try {
    if (request.method !== 'POST') throw new ClientSafeError(405, 'Use POST for auth requests.');
    if (!route) throw new ClientSafeError(404, 'Unknown auth route.');

    // Per-IP ceiling on every route (cheap DoS/abuse brake).
    await enforceRateLimit(`ip:${route}:${ip}`, POLICIES.ipGeneral);

    const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;

    if (route === 'signup') {
      const email = validateEmail(payload.email);
      const password = validatePassword(payload.password);
      await enforceRateLimit(`signup:${ip}`, POLICIES.signupPerIp);
      const r = await gotrue.signUp(email, password);
      await writeAudit({ event: 'signup', email, ip, success: r.ok, reason: r.ok ? undefined : `gotrue_${r.status}` });
      // Only surface genuine server faults. For a new address (2xx) OR an
      // already-registered one (4xx), return an IDENTICAL 200 body so signup
      // cannot be used to enumerate registered emails. GoTrue sends the
      // confirmation email only on a real new signup; the client always shows
      // "check your inbox" and completes via email confirmation + login.
      if (r.status >= 500) throw new ClientSafeError(502, safeAuthMessage('signup', r.status));
      response = respond(200, {
        message: 'If that email can be registered, check your inbox to confirm your account.',
      });
    } else if (route === 'login') {
      const email = validateEmail(payload.email);
      const password = validatePassword(payload.password);
      const r = await gotrue.passwordGrant(email, password);
      if (!r.ok) {
        // Count only failures toward the per-email lockout. Fail CLOSED: a
        // brute-force lockout must not silently disappear if the RPC is down.
        await enforceRateLimit(`login-fail:${email}`, POLICIES.loginFailure, { failClosed: true });
        await writeAudit({ event: 'login', email, ip, success: false, reason: `gotrue_${r.status}` });
        throw new ClientSafeError(401, safeAuthMessage('login', r.status));
      }
      await writeAudit({ event: 'login', email, ip, success: true });
      response = respond(200, r.body);
    } else if (route === 'refresh') {
      const token = typeof payload.refresh_token === 'string' ? payload.refresh_token : '';
      if (!token) throw new ClientSafeError(400, safeAuthMessage('refresh', 400));
      await enforceRateLimit(`refresh:${ip}`, POLICIES.refreshPerIp);
      const r = await gotrue.refresh(token);   // GoTrue rotates + reuse-detects (project setting)
      await writeAudit({ event: 'refresh', ip, success: r.ok, reason: r.ok ? undefined : `gotrue_${r.status}` });
      if (!r.ok) throw new ClientSafeError(401, safeAuthMessage('refresh', r.status));
      response = respond(200, r.body);
    } else if (route === 'otp-request') {
      const { claims } = await verifySupabaseJwt(request); // 401 if missing/invalid
      const uid = String(claims.sub);
      const { e164 } = parseOtpPhone(payload.phone);
      const channel = parseOtpChannel(payload.channel);
      // Resend cooldown per user, hourly cap per phone (on top of the IP ceiling).
      await enforceRateLimit(`otp-send:${uid}`, POLICIES.otpSendPerUser);
      await enforceRateLimit(`otp-send-phone:${e164}`, POLICIES.otpSendPerPhone);
      const result = await requestOtp(uid, e164, channel);
      await writeAudit({ event: 'otp_request', subject: e164, ip, success: true, reason: channel });
      response = respond(200, result);
    } else if (route === 'otp-verify') {
      const { claims } = await verifySupabaseJwt(request);
      const uid = String(claims.sub);
      const { e164 } = parseOtpPhone(payload.phone);
      // Fail CLOSED: code-guessing protection must survive an RPC outage.
      await enforceRateLimit(`otp-verify:${uid}`, POLICIES.otpVerifyPerUser, { failClosed: true });
      try {
        const result = await verifyOtp(uid, e164, payload.code);
        await writeAudit({ event: 'otp_verify', subject: e164, ip, success: true });
        response = respond(200, result);
      } catch (error) {
        await writeAudit({
          event: 'otp_verify', subject: e164, ip, success: false,
          reason: error instanceof ClientSafeError ? 'rejected' : 'error',
        });
        throw error;
      }
    } else { // logout
      const token = getBearerToken(request); // throws ClientSafeError(401) if missing
      const r = await gotrue.logout(token);
      await writeAudit({ event: 'logout', ip, success: r.ok, reason: r.ok ? undefined : `gotrue_${r.status}` });
      if (!r.ok) throw new ClientSafeError(400, safeAuthMessage('logout', r.status));
      response = respond(200, { success: true });
    }

    finishEdgeObservation(observation, { status: response.status });
    return response;
  } catch (error) {
    capturedError = error;
    const status = getErrorStatus(error);
    // clientErrorMessage returns the ClientSafeError message (safe by construction)
    // or a generic fallback for anything unexpected. Real details are logged, not returned.
    response = respond(status, { error: { message: clientErrorMessage(error) } });
    finishEdgeObservation(observation, { status, error: capturedError });
    if (status >= 500) logEdgeEvent('error', 'auth-gateway failure', { route, status });
    return response;
  }
});
