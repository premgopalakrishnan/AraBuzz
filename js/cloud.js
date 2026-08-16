/* ==========================================================================
   AraBuzz — cloud.js
   Everything that talks to Supabase.

   Two rules this file exists to keep:

   1  The browser never holds a secret. The key below is Supabase's publishable
      key — it is designed to be read by anyone. It grants nothing on its own.
      What a person may actually see or change is decided by row-level security
      inside Postgres, against the identity in their signed session. A tampered
      copy of this app is exactly as powerless as an untampered one.

   2  Nothing here blocks the child. Every call is either part of signing in,
      or a background sync. She never waits on a network request to spell a
      word — that all runs against the local store, as it always has.
   ========================================================================== */
(function (w) {
  'use strict';

  const URL  = 'https://wjrhkihaoicmymycxzlj.supabase.co';
  const KEY  = 'sb_publishable_utTnSh3PzSUliZ0Qn33Inw_QLA3VQ7t';
  const SCHEMA = 'arabuzz';

  /** The wording currently in force. Bump this and every parent is asked again. */
  const CONSENT_VERSION = '1.0';

  let sb = null;          // the Supabase client
  let session = null;     // the signed-in session, or null
  let me = null;          // { parent, family, children[], isAdmin, hasConsented }
  const listeners = [];

  /* ------------------------------------------------------------------ init */
  function client() {
    if (sb) return sb;
    if (!w.supabase || !w.supabase.createClient) return null;
    sb = w.supabase.createClient(URL, KEY, {
      db: { schema: SCHEMA },
      auth: {
        persistSession: true,          // she should not sign in twice
        autoRefreshToken: true,
        detectSessionInUrl: true       // magic links land back here
      }
    });
    return sb;
  }

  function available() { return !!client(); }

  async function start() {
    const c = client();
    if (!c) return null;
    const { data } = await c.auth.getSession();
    session = data ? data.session : null;
    c.auth.onAuthStateChange(async (_evt, s) => {
      session = s;
      me = null;
      await load();
      emit();
    });
    if (session) await load();
    return session;
  }

  function onChange(fn) { listeners.push(fn); }
  function emit() { listeners.forEach(fn => { try { fn(me); } catch (e) { console.error(e); } }); }

  /* ------------------------------------------------------------- signing in */
  /**
   * A link in an email, and nothing to remember. `redirect` brings them back to
   * wherever they started — the join page, or the app itself.
   */
  async function sendLink(email, redirect) {
    const c = client(); if (!c) throw new Error('offline');
    const { error } = await c.auth.signInWithOtp({
      email: String(email || '').trim().toLowerCase(),
      options: { emailRedirectTo: redirect || location.origin }
    });
    if (error) throw error;
    return true;
  }

  async function signOut() {
    const c = client(); if (!c) return;
    await c.auth.signOut();
    session = null; me = null; emit();
  }

  function signedIn()  { return !!session; }
  function myEmail()   { return session && session.user ? session.user.email : null; }

  /* ------------------------------------------------------------------- who */
  /** Load everything about the signed-in adult in as few round trips as possible. */
  async function load() {
    const c = client();
    if (!c || !session) { me = null; return null; }

    const [{ data: parent }, { data: consented }] = await Promise.all([
      c.from('parents').select('id, family_id, full_name, mobile, role, pin_set_at').eq('id', session.user.id).maybeSingle(),
      c.rpc('has_consented', { p_version: CONSENT_VERSION })
    ]);

    if (!parent) {                        // signed in, but not yet joined
      me = { parent: null, family: null, children: [], isAdmin: false,
             hasConsented: false, email: myEmail() };
      return me;
    }

    const [{ data: family }, { data: children }] = await Promise.all([
      c.from('families').select('id, name, active').eq('id', parent.family_id).maybeSingle(),
      c.from('children').select('*').eq('family_id', parent.family_id).order('created_at')
    ]);

    me = {
      parent, family,
      children: children || [],
      isAdmin: parent.role === 'admin',
      hasConsented: !!consented,
      email: myEmail()
    };
    return me;
  }

  function whoAmI() { return me; }

  /* --------------------------------------------------------------- joining */
  /** What the invitation page may show before anyone has signed in. */
  async function peekInvite(code) {
    const c = client(); if (!c) throw new Error('offline');
    const { data, error } = await c.rpc('peek_invite', { p_code: code });
    if (error) throw error;
    return (data && data[0]) || null;
  }

  async function acceptInvite(code, fullName, mobile) {
    const c = client(); if (!c) throw new Error('offline');
    const { data, error } = await c.rpc('accept_invite', {
      p_code: code, p_full_name: fullName, p_mobile: mobile || null
    });
    if (error) throw error;
    await load();
    return data;
  }

  /** Prem has no invitation to accept; he claims the admin seat instead. */
  async function bootstrapAdmin(fullName) {
    const c = client(); if (!c) throw new Error('offline');
    const { data, error } = await c.rpc('bootstrap_admin', {
      p_full_name: fullName, p_family_name: 'CoKindle Labs'
    });
    if (error) throw error;
    await load();
    return data;
  }

  /* --------------------------------------------------------------- consent */
  async function recordConsent(name) {
    const c = client(); if (!c) throw new Error('offline');
    const { error } = await c.from('consents').insert({
      parent_id: session.user.id, version: CONSENT_VERSION, agreed_name: name || null
    });
    // agreeing twice is not an error, it is just already true
    if (error && !/duplicate key/i.test(error.message)) throw error;
    if (me) me.hasConsented = true;
    return true;
  }

  /* ------------------------------------------------------------------- PIN */
  // Never sent anywhere but Postgres, never stored here, never comparable in
  // the browser — the hash is not a column this client is allowed to read.
  async function setPin(pin) {
    const c = client(); if (!c) throw new Error('offline');
    const { error } = await c.rpc('set_pin', { p_pin: String(pin) });
    if (error) throw error;
    await load();
    return true;
  }

  async function checkPin(pin) {
    const c = client(); if (!c) throw new Error('offline');
    const { data, error } = await c.rpc('check_pin', { p_pin: String(pin) });
    if (error) throw error;
    return data === true;
  }

  function pinIsSet() { return !!(me && me.parent && me.parent.pin_set_at); }

  /* -------------------------------------------------------------- children */
  async function addChild(fields) {
    const c = client(); if (!c) throw new Error('offline');
    const { data, error } = await c.from('children').insert({
      family_id: me.parent.family_id,
      name: fields.name,
      avatar: fields.avatar || null,
      colour: fields.colour || null,
      class_label: fields.classLabel || null
    }).select().single();
    if (error) throw error;
    await load();
    return data;
  }

  async function saveChild(id, patch) {
    const c = client(); if (!c) throw new Error('offline');
    const { error } = await c.from('children').update(patch).eq('id', id);
    if (error) throw error;
    await load();
  }

  /* ------------------------------------------------------------ admin bits */
  async function createInvite(familyName, email, childName) {
    const c = client(); if (!c) throw new Error('offline');
    const { data, error } = await c.rpc('create_invite', {
      p_family_name: familyName,
      p_email: email || null,
      p_note: childName ? JSON.stringify({ child: childName }) : null
    });
    if (error) throw error;
    return data;
  }

  /** Recorded every time an admin opens a family's view. */
  async function logAdminView(familyId, childId) {
    const c = client(); if (!c || !me || !me.isAdmin) return;
    try {
      await c.from('admin_views').insert({
        admin_id: session.user.id, family_id: familyId, child_id: childId || null
      });
    } catch (e) { console.warn('view not logged', e); }
  }

  w.Cloud = {
    CONSENT_VERSION, SUPABASE_URL: URL,
    available, start, onChange,
    sendLink, signOut, signedIn, myEmail,
    load, whoAmI,
    peekInvite, acceptInvite, bootstrapAdmin,
    recordConsent,
    setPin, checkPin, pinIsSet,
    addChild, saveChild,
    createInvite, logAdminView,
    get session() { return session; }
  };
})(window);
