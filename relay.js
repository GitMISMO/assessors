/* MISMO Service Orders — the relay module.
 *
 * Every credential and every relay call in this tool goes through this file and
 * nowhere else.  Nothing else in the page builds a request, holds a token, or
 * decides what somebody may see.
 *
 * REWRITTEN 27 September 2026 against the relay's own source — GitMISMO/
 * initiative-hub, _dev/aws/index.mjs, 1,242 lines, sha256 39df37c9….  The
 * session-12 version was written to a guessed contract and is kept beside this
 * one as relay.js.session12 until the first live call succeeds.
 *
 * Four things changed from that guess, and they are the whole of the rewrite:
 *
 *   was                                    is
 *   ---------------------------------      ------------------------------------
 *   base /relay                            the Lambda function URL
 *   X-Facilitator-Key on every request     POST /{project}/auth/login, then
 *                                          Authorization: Bearer <token>
 *   PUT /{repo}/file/{path}                POST /{project}/commit with
 *                                          { message, parentSha, files: [...] }
 *   parentSha is the blob sha              parentSha is the COMMIT sha, and a
 *                                          read hands back a BLOB sha.  They are
 *                                          different things and cannot be
 *                                          swapped — see head() below.
 *
 * Rules this file exists to keep:
 *   1. The relay decides what comes back.  The page never filters.
 *   2. The token lives in sessionStorage, not localStorage: it dies with the tab
 *      rather than sitting on disk for four hours.  Every tool on
 *      resources.mismo.org shares one origin, so storage is only ever cleared
 *      one named key at a time — never wholesale.
 *   3. Nothing about who somebody is is inferred.  The access map comes from the
 *      relay at sign-in and is re-read from it, never widened here.
 *   4. Every save carries a parentSha wherever one can be had, so a save that
 *      would overwrite somebody else's is refused rather than silently applied.
 */
(function (global) {
  'use strict';

  var CFG = global.RELAY || {};
  var BASE = String(CFG.base || '').replace(/\/+$/, '');

  var NS = 'resources:service-orders:';
  var TOKEN = 'session';

  /* ---- storage, namespaced, never cleared wholesale ---------------------- */
  function sput(name, value) { try { sessionStorage.setItem(NS + name, value); } catch (e) {} }
  function sget(name) { try { return sessionStorage.getItem(NS + name); } catch (e) { return null; } }
  function sdrop(name) { try { sessionStorage.removeItem(NS + name); } catch (e) {} }

  /* ---- the session ------------------------------------------------------- */
  /* What the relay hands back at sign-in: token, name, email, access, expiresAt.
     The token is NOT project-bound — signing in once covers every key the person
     has — so the access map is what says which projects they may ask about. */
  function session() {
    var raw = sget(TOKEN);
    if (!raw) return null;
    var s;
    try { s = JSON.parse(raw); } catch (e) { sdrop(TOKEN); return null; }
    if (!s || !s.token) { sdrop(TOKEN); return null; }
    /* A token lasts four hours.  Checking the clock here means an expired session
       shows a sign-in rather than a wall of failed requests. */
    if (s.expiresAt && new Date(s.expiresAt).getTime() <= Date.now()) { sdrop(TOKEN); return null; }
    return s;
  }
  function signedIn() { return !!session(); }
  function signOut() { sdrop(TOKEN); HEAD = {}; }

  function login(project, email, password) {
    return fetch(BASE + '/' + enc(project) + '/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: email, password: password })
    }).then(readBody).then(function (r) {
      if (!r.ok) throw tag(fail(r.status, r.body), project);
      sput(TOKEN, JSON.stringify(r.body));
      HEAD = {};
      return r.body;
    });
  }

  /* ---- requests ---------------------------------------------------------- */
  function enc(s) { return encodeURIComponent(String(s)); }
  function encPath(p) { return String(p).split('/').map(encodeURIComponent).join('/'); }

  function fail(status, body) {
    var code = (body && body.error) || '';
    var e = new Error((body && body.message) || code || ('relay ' + status));
    e.status = status;
    e.code = code;
    e.body = body || null;
    /* Fail closed: these mean "not you, not here, not any more" and the page
       should say so rather than retry or show an empty screen as if it were
       an empty folder. */
    e.closed = status === 401 || status === 403;
    e.missing = status === 404 || code === 'NOT_FOUND';
    e.conflict = status === 409 || code === 'CONFLICT';
    return e;
  }

  /* Record which project key a failure was against.  Set once and never
     overwritten, so the FIRST key that failed is the one reported. */
  function tag(e, project) {
    if (e && project && !e.project) e.project = project;
    return e;
  }

  function readBody(r) {
    return r.json().catch(function () { return {}; })
      .then(function (j) { return { ok: r.ok, status: r.status, body: j }; });
  }

  function send(method, path, body) {
    var s = session();
    if (!s) return Promise.reject(fail(401, { error: 'NO_SESSION', message: 'Sign in again.' }));
    var opts = { method: method, headers: { 'Authorization': 'Bearer ' + s.token } };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    /* Every path is /{project}/..., so the project is recoverable here.  Naming
       it on the error is what lets the page say WHICH key the relay refused
       instead of a bare code somebody then has to guess at. */
    var proj = decodeURIComponent(String(path).split('/')[1] || '');
    return fetch(BASE + path, opts).then(readBody).then(function (r) {
      if (r.status === 401) { sdrop(TOKEN); throw tag(fail(401, r.body), proj); }
      if (!r.ok) throw tag(fail(r.status, r.body), proj);
      return r.body;
    });
  }

  /* ---- reading ----------------------------------------------------------- */
  /* GET /{project}/file/{path} -> { path, size, sha, content }, content base64.
     The sha is the BLOB sha.  It identifies the bytes and is useful for telling
     whether a file changed; it is NOT what /commit wants for parentSha. */
  function read(project, path) {
    return send('GET', '/' + enc(project) + '/file/' + encPath(path), null)
      .then(function (r) {
        return { sha: r.sha, size: r.size, data: JSON.parse(fromB64(r.content)) };
      });
  }

  /* The same read, WITHOUT parsing. read() assumes JSON and would throw on the
     first byte of a PDF, so anything that is not JSON — an executed agreement,
     a scanned MSA — has to come back through here as base64. */
  function readRaw(project, path) {
    return send('GET', '/' + enc(project) + '/file/' + encPath(path), null)
      .then(function (r) {
        return { sha: r.sha, size: r.size, base64: String(r.content || '').replace(/\s/g, '') };
      });
  }

  /* Read a file that may not exist yet, without turning a 404 into an error. */
  function readOr(project, path, fallback) {
    return read(project, path).catch(function (e) {
      if (e.missing) return { sha: null, size: 0, data: fallback, absent: true };
      throw e;
    });
  }

  function fromB64(b64) {
    var bin = atob(String(b64).replace(/\s/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    /* TextDecoder, not escape/unescape: company names and the order wording carry
       em-dashes and curly quotes, and a byte-wise read mangles every one of them. */
    return new TextDecoder('utf-8').decode(bytes);
  }

  /* ---- the commit sha, and how to get one -------------------------------- */
  /* No route returns the branch head.  But /commit checks parentSha against the
     head BEFORE it creates a single blob, so a commit sent with a knowingly stale
     parentSha is refused with 409 { error:'CONFLICT', head } and writes nothing.
     That is a clean, side-effect-free way to learn the head once per project per
     session, and it is why no write here has to go out unlocked. */
  var HEAD = {};
  var STALE = '0000000000000000000000000000000000000000';

  function head(project) {
    if (HEAD[project]) return Promise.resolve(HEAD[project]);
    return send('POST', '/' + enc(project) + '/commit', {
      message: 'head probe',
      parentSha: STALE,
      files: [{ path: 'notify/.head-probe', content: '{}' }]
    }).then(function () {
      /* Only reachable if the head really is forty zeros, which it never is.
         If it somehow committed, the sha it returns is the new head. */
      return null;
    }).catch(function (e) {
      if (e.conflict && e.body && e.body.head) { HEAD[project] = e.body.head; return e.body.head; }
      /* The probe is refused for a reason of its own — no write access, say.
         Fall back to an unlocked write rather than blocking the person. */
      return null;
    });
  }

  /* ---- writing ----------------------------------------------------------- */
  /* POST /{project}/commit { message, parentSha, files:[{path, content, encoding}] }
     -> { commit, savedBy }.  One to fifty files, one commit, all or nothing:
     a single disallowed path rejects the whole thing before anything is written. */
  function commit(project, files, message) {
    if (!files || !files.length) return Promise.reject(fail(400, { error: 'BAD_CONTENT' }));
    if (files.length > 50) return Promise.reject(fail(400, { error: 'TOO_MANY_FILES' }));
    return head(project).then(function (parent) {
      var body = { message: message || 'Service orders update', files: files };
      if (parent) body.parentSha = parent;
      return send('POST', '/' + enc(project) + '/commit', body);
    }).then(function (r) {
      HEAD[project] = r.commit;          // our own commit is the new head
      return r;
    }).catch(function (e) {
      if (e.conflict) {
        /* Somebody saved first.  Take the head the relay just told us — or forget
           what we thought it was, if it did not — so the caller's retry re-reads
           and applies the same change to the copy that is actually there. */
        if (e.body && e.body.head) { HEAD[project] = e.body.head; } else { delete HEAD[project]; }
      }
      throw e;
    });
  }

  function jsonFile(path, data) {
    return { path: path, content: JSON.stringify(data, null, 1) };
  }

  /* A PDF or any other binary goes through untouched.  Treating it as text would
     mangle every byte that is not valid UTF-8, and it would only show when
     somebody tried to open the file. */
  function binaryFile(path, base64) {
    return { path: path, content: String(base64).replace(/\s/g, ''), encoding: 'base64' };
  }

  /* Read, change, save — and if somebody saved in between, read the copy that is
     actually there, apply the same change to IT, and save again.  The change
     function is handed a fresh copy every time, so a merge is never guessed at. */
  function update(project, path, change, message, fallback, tries) {
    tries = tries == null ? 3 : tries;
    return readOr(project, path, fallback).then(function (cur) {
      var next = change(cur.data);
      return commit(project, [jsonFile(path, next)], message);
    }).catch(function (e) {
      if (e.conflict && tries > 1) return update(project, path, change, message, fallback, tries - 1);
      throw e;
    });
  }

  /* ---- signing in without knowing the project first ----------------------
     The relay's sign-in lives at POST /{project}/auth/login, so it wants a
     project name before it will tell you which projects you have.  The token it
     hands back is NOT project-bound, so signing in against any one key the
     person holds covers all of them.  We therefore try the keys in turn and
     keep the first that works.  A contractor succeeds on their own key; MISMO
     staff succeed on the first.  Wrong password fails on every key and is
     reported once, as one failure, not five. */
  function loginAny(email, password) {
    var keys = (CFG.projects || []).slice();
    if (!keys.length) return Promise.reject(fail(0, { message: 'No project keys are configured for this page.' }));
    var lastErr = null, unkErr = null, sawForbidden = false, sawUnknown = false;
    function attempt(i) {
      if (i >= keys.length) {
        /* ⚠ Every key refused, and WHY matters — these three are different
           things and only one of them is the person's fault.

             403 on some key   the password is RIGHT; the relay authenticated
                               them and then said they have no access to that
                               project.  Their account simply has no service
                               orders on it.  Never call this a bad password.
             UNKNOWN_PROJECT   the relay has never heard of these projects.  A
                               setup gap, and nothing the person can do.
             401 everywhere    genuinely not recognised. */
        /* ⚠ UNKNOWN_PROJECT is checked FIRST and on purpose.  A relay that has
           never heard of a project cannot have an opinion about who may reach
           it, so a 403 collected alongside one says nothing about the account.
           Reporting the 403 first tells a perfectly good account that it has no
           service orders, and points the person at an email that fixes
           nothing. */
        if (sawUnknown) throw (unkErr || lastErr);
        if (sawForbidden) {
          var ne = fail(403, { error: 'NO_SERVICE_ORDERS',
            message: 'This account has no service orders on it.' });
          ne.noServiceOrders = true;
          throw ne;
        }
        throw lastErr || fail(401, { error: 'NO_ACCESS',
          message: 'That email and password were not recognised.' });
      }
      return login(keys[i], email, password).catch(function (e) {
        if (e.status === 403) { sawForbidden = true; lastErr = e; return attempt(i + 1); }
        if (e.code === 'UNKNOWN_PROJECT') { sawUnknown = true; unkErr = unkErr || e; lastErr = e; return attempt(i + 1); }
        if (e.closed) { lastErr = e; return attempt(i + 1); }
        throw e;
      });
    }
    return Promise.resolve().then(function () { return attempt(0); });
  }

  /* ---- who the signed-in person is --------------------------------------
     The old relay had a /whoami.  This one does not, so the answer is worked
     out from the access map the sign-in returns — which comes FROM the relay
     and is never widened here.

       one key, staff   a contracting company
       every key, admin Jonna
       every key, staff the VP or the President — told apart by reading the
                        names off a company's own orders file, which is in a
                        private repository and needs the sign-in to read.

     Nothing about a person is inferred from their email address by this page. */
  /* ⚠ ONLY the keys this page is configured for.
     An account is one account across every tool on resources.mismo.org, so the
     access map a sign-in returns also carries summit-hq, glossary and anything
     else that person has.  Treating one of those as a service-orders project
     asks the wrong repository for an orders file and the relay rightly answers
     UNKNOWN_PROJECT.  The page's own project list is the filter. */
  function keysOf(sess) {
    var acc = (sess && sess.access) || {};
    var mine = CFG.projects || [];
    if (!mine.length) return Object.keys(acc);
    return mine.filter(function (k) { return Object.prototype.hasOwnProperty.call(acc, k); });
  }
  /* Everything else the account can reach — never used to decide anything, only
     to explain a "you have no service orders" screen without guessing. */
  function otherKeys(sess) {
    var acc = (sess && sess.access) || {};
    var mine = CFG.projects || [];
    return Object.keys(acc).filter(function (k) { return mine.indexOf(k) < 0; });
  }
  /* ⚠ This module's own copy. The views module below has one too; they share no
     scope, so it has to be declared on both sides rather than reached for. */
  function isLiteKey(k) { return (CFG.lite || []).indexOf(k) >= 0; }

  function whoami() {
    var sess = session();
    if (!sess) {
      var e = new Error('Not signed in');
      e.needsLogin = true;
      return Promise.reject(e);
    }
    var keys = keysOf(sess);
    var slugs = CFG.slugs || {};
    var me = { name: sess.name || sess.email, email: sess.email, access: sess.access || {},
               keys: keys, otherKeys: otherKeys(sess) };

    /* Every COMPANY the person may reach, in the order the keys are configured.
       ⚠ DEDUPED, and that is not tidiness.
       Two keys now point at the same company — the full one and the hours-only
       one — so a contractor holding both appeared here TWICE. Everything below
       counted that as two companies, and "more than one company" is how this
       page recognises MISMO staff: a facilitator left on both rows was handed
       the administrator's screen, with every company's details on it. Companies
       are what the question is about, so companies are what gets counted. */
    var seen = {};
    me.slugs = [];
    keys.forEach(function (k) {
      var sl = slugs[k] || k.replace(/^so-/, '').replace(/-hours$/, '');
      if (seen[sl]) return;
      seen[sl] = 1; me.slugs.push(sl);
    });
    me.slug = me.slugs[0];
    me.project = keys[0];
    me.title = '';

    if (!keys.length) { me.kind = 'none'; return Promise.resolve(me); }

    /* ⚠ Hours-only keys can NEVER make somebody staff, however many they hold.
       Checked before the company count, so a mistake in the admin panel cannot
       promote anyone — the worst it can do is give them a company they should
       not have, on the rate-free screen. */
    var allLite = keys.length > 0 && keys.every(function (k) { return isLiteKey(k); });
    if (allLite) {
      me.kind = 'contractor';
      return Promise.resolve(me);
    }

    /* ONE company — whether they hold one key for it or both — is a
       contracting company, never staff. */
    if (me.slugs.length === 1) {
      me.kind = 'contractor';
      return Promise.resolve(me);
    }

    /* Several keys: read one company's file to pick up the MISMO names and
       titles.  The titles print on approvals, so they come from the data rather
       than being typed into this page.  One extra read, once, at sign-in. */
    return read(me.project, 'orders/' + me.slug + '.json').then(function (r) {
      var F = r.data || {};
      var vp = F.vpProduct || {}, pres = F.mismoSigner || {};
      var mine = String(sess.email || '').toLowerCase();
      if (mine && mine === String(vp.email || '').toLowerCase()) {
        me.kind = 'vp-product';
        me.name = me.name || vp.name; me.title = vp.title || '';
      } else if (mine && mine === String(pres.email || '').toLowerCase()) {
        me.kind = 'president';
        me.name = me.name || pres.name; me.title = pres.title || '';
      } else {
        me.kind = 'admin';
        me.title = 'Director of Programs & Operations';
      }
      return me;
    }).catch(function () {
      /* The name-matching read failed. The access map is still trustworthy, so
         fall back on it rather than refusing to show anything. */
      me.kind = keys.some(function (k) { return (sess.access || {})[k] === 'admin'; })
        ? 'admin' : 'president';
      return me;
    });
  }

  /* Kept so the page has one call to make at start-up.  There is nothing to
     boot any more — the session either exists in this tab or it does not. */
  function boot() { return session(); }

  global.MISMO_RELAY = {
    base: BASE,
    boot: boot, whoami: whoami, loginAny: loginAny,
    login: login, signOut: signOut, signedIn: signedIn, session: session,
    read: read, readOr: readOr, readRaw: readRaw,
    commit: commit, update: update,
    jsonFile: jsonFile, binaryFile: binaryFile,
    limits: { filesPerCommit: 50, bodyBytes: 1000000 },
    store: { put: sput, get: sget, drop: sdrop, prefix: NS }
  };
})(window);
