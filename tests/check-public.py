#!/usr/bin/env python3
"""Nothing private in this public repository (21 Nov 2026).

The Assessor Portal has to be public for GitHub Pages, so it holds the page's code and never the records: each
firm's engagements live in its own private repository (as-<firm>-data) and are read through the relay with the
firm's own sign-in. Checked on every change:

  - no contact address other than mismo.org, mba.org and made-up example ones
  - no Aptify invoice number and no dollar figure in the page
  - no GitHub key pasted anywhere (the upload flow's address is public by design: it checks each caller's sign-in)
  - the relay settings and relay.js are still wired in, and the relay may only be asked about the three
    assessor firm keys (as-...), never another tool's records
  - the test fixture is made up (its firm and every company are "Example ...")

Company names are checked against the private records by the "Public pages" check in cms-data; the list of
companies cannot be written down here without publishing it.
Run: python3 tests/check-public.py
"""
import json, os, re, sys

ROOT = os.path.join(os.path.dirname(__file__), "..")
EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
ALLOWED_EMAIL = re.compile(r"@(mismo\.org|mba\.org|example\.com|example\.org|yourfirm\.com|yourcompany\.com|company\.com)$", re.I)
INVOICE = re.compile(r"\b6[23]\d{5}\b")
FIGURE = re.compile(r"\$[\d,]{4,}")
SECRET = re.compile(r"(ghp_|gho_|ghs_|ghu_|github_pat_)[A-Za-z0-9_]{20,}")
# The upload flow's address is in the page on purpose: the flow checks the assessor's own sign-in on every call.

problems = []
for f in sorted(os.listdir(ROOT)):
    if not re.search(r"\.(html|js|css|md|json)$", f):
        continue
    t = open(os.path.join(ROOT, f), encoding="utf-8").read()
    bad = sorted({e for e in EMAIL.findall(t) if not ALLOWED_EMAIL.search(e)})
    if bad:
        problems.append("%s carries contact address(es): %s" % (f, ", ".join(bad[:5])))
    inv = sorted(set(INVOICE.findall(t)))
    if inv:
        problems.append("%s carries Aptify invoice number(s): %s" % (f, ", ".join(inv[:5])))
    if SECRET.search(t):
        problems.append("%s carries what looks like a GitHub key" % f)
    if f == "index.html":
        fig = sorted(set(FIGURE.findall(t)))
        if fig:
            problems.append("index.html carries dollar figure(s): %s" % ", ".join(fig[:5]))
        if '<script src="relay.js"></script>' not in t:
            problems.append("index.html no longer loads relay.js, so nobody could sign in")
        m = re.search(r"<script>window\.RELAY=(\{.*?\});</script>", t)
        if not m:
            problems.append("index.html has no relay settings (window.RELAY)")
        else:
            try:
                cfg = json.loads(m.group(1))
                other = [k for k in cfg.get("projects", []) if not k.startswith("as-")]
                if other:
                    problems.append("the portal may ask the relay about other tools' records: %s" % ", ".join(other))
            except ValueError as e:
                problems.append("the relay settings do not parse: %s" % e)

fx = os.path.join(ROOT, "tests", "fixtures", "engagements.json")
if os.path.exists(fx):
    d = json.load(open(fx, encoding="utf-8"))
    if not str(d.get("firm", "")).startswith("Example"):
        problems.append("the test fixture's firm is not a made-up one")
    real = sorted({e.get("org") for e in d.get("engagements", []) if not str(e.get("org", "")).startswith("Example")})
    if real:
        problems.append("the test fixture names companies that are not made up")
    t = open(fx, encoding="utf-8").read()
    bad = sorted({e for e in EMAIL.findall(t) if not ALLOWED_EMAIL.search(e)})
    if bad:
        problems.append("the test fixture carries contact address(es)")

for p in problems:
    print("PROBLEM  " + p)
print("%d problem(s)." % len(problems))
sys.exit(1 if problems else 0)
