/* Checks every script in the Assessor Portal before it goes live (21 Nov 2026, copied from the CMS checks).

   1. Every script parses: the inline scripts in each page (the application itself included) and the
      separate .js files. A page whose script does not parse is a blank page for everyone.
   2. No function is defined twice in the same scope. In one script the later definition silently
      replaces the earlier one everywhere: on 29 Oct 2026 the renewal code's saveInvoice replaced the
      record panel's, and its Paid box did nothing; three day counters ran as the least careful one.

   Run: node tests/check-scripts.js   (needs acorn and acorn-walk; the workflow installs them) */
"use strict";
const fs = require("fs");
const path = require("path");
const acorn = require("acorn");
const walk = require("acorn-walk");

const ROOT = path.join(__dirname, "..");
const SKIP = new Set([]);
let problems = 0, checked = 0;
const say = m => { problems++; console.log("PROBLEM  " + m); };

function check(code, where) {
  let ast;
  try { ast = acorn.parse(code, { ecmaVersion: "latest", sourceType: "script", allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true, locations: true }); }
  catch (e) { say(where + " does not parse: " + e.message); return; }
  checked++;
  const scopes = new Map();
  walk.ancestor(ast, {
    FunctionDeclaration(n, anc) {
      const fnOwner = anc.slice(0, -1).reverse().find(a => /^(FunctionDeclaration|FunctionExpression|ArrowFunctionExpression|Program)$/.test(a.type)) || ast;
      const key = fnOwner;
      if (!scopes.has(key)) scopes.set(key, {});
      const o = scopes.get(key);
      (o[n.id.name] = o[n.id.name] || []).push(n.loc.start.line);
    }
  });
  for (const o of scopes.values()) for (const [name, lines] of Object.entries(o))
    if (lines.length > 1) say(where + ": function " + name + " is defined " + lines.length + " times in the same scope (lines " + lines.join(", ") + " of that script); only the last one runs");
}

for (const f of fs.readdirSync(ROOT).sort()) {
  if (SKIP.has(f)) continue;
  const p = path.join(ROOT, f);
  if (f.endsWith(".js")) check(fs.readFileSync(p, "utf8"), f);
  if (!f.endsWith(".html")) continue;
  const html = fs.readFileSync(p, "utf8");
  let i = 0;
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    i++;
    const attrs = m[1], body = m[2];
    if (/\bsrc=/.test(attrs) || !body.trim()) continue;
    const type = (attrs.match(/type="([^"]+)"/) || [])[1] || "";
    if (type && !/javascript|module|x-cms-app/i.test(type)) continue;   /* data blocks (JSON) */
    const line = html.slice(0, m.index).split("\n").length;
    check(body, f + " script " + i + " (starts line " + line + ")");
  }
}
console.log(checked + " scripts checked, " + problems + " problem(s).");
process.exit(problems ? 1 : 0);
