// The outside services the backend calls, answered inside the demo. Each answer is shaped like the
// service's own success, so the flow carries on exactly as in Live, and comes with a quiet note for
// the screen saying what would have been sent. Nothing leaves the browser.
const read = body => { try { return typeof body === 'string' ? JSON.parse(body) : null; } catch { return null; } };
const reply = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const id = () => 'demo-' + crypto.randomUUID();
let hostawayIds = 900000;

export async function fakeServiceResponse(url, method, body) {
  // Email (Resend): notices, and the team's own emails such as the client enquiry form.
  if (url.hostname === 'api.resend.com') {
    if (method === 'GET') return { response: reply({ id: decodeURIComponent(url.pathname.split('/').pop()), last_event: 'delivered' }) };
    const email = read(body) ?? {};
    const to = [].concat(email.to ?? []).join(', ') || 'the recipient';
    return { response: reply({ id: id() }), note: `In demo, this email would be sent to ${to}${email.subject ? `: “${email.subject}”` : ''}.` };
  }
  // Phone notifications (Expo push).
  if (url.hostname === 'exp.host') {
    const input = read(body) ?? {};
    if (url.pathname.endsWith('/getReceipts')) return { response: reply({ data: Object.fromEntries((input.ids ?? []).map(x => [x, { status: 'ok' }])) }) };
    return { response: reply({ data: { status: 'ok', id: id() } }), note: `In demo, a phone notification would be sent${input.body ? `: “${input.body}”` : ''}.` };
  }
  // The channel manager (Hostaway).
  if (url.hostname === 'api.hostaway.com') {
    const path = url.pathname.replace(/^\/v1/, '');
    if (path === '/accessTokens') return { response: reply({ access_token: 'demo', expires_in: 86400 }) };
    if (method === 'GET') return { response: reply({ status: 'success', result: [], count: 0 }) };
    const note = /\/conversations\/[^/]+\/messages$/.test(path) ? 'In demo, this message would be sent to the guest through Hostaway.'
      : /\/reservations\/[^/]+(\/statuses\/cancelled)?$/.test(path) ? 'In demo, Hostaway would be asked to cancel this reservation.'
      : 'In demo, this would be sent to Hostaway.';
    return { response: reply({ status: 'success', result: { id: ++hostawayIds } }), note };
  }
  return null;
}
