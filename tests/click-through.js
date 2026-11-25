/* Click through the whole Assessor Portal as a stranger's browser would, and fail on any script error
   (21 Nov 2026). The page is served from this repository; the shared sign-in and MISMO's relay are stood in
   for. The firm's engagements are the MADE-UP fixture in tests/fixtures/engagements.json; every other read
   answers "not found" and every save is refused, so nothing here touches the real records or saves anything.

   Three people are tried: an assessor (one firm key), a MISMO administrator viewing as a firm (View As), and a
   MISMO administrator on their own screen (View As chooser, Help, System Health).
   At 1400px light and 390px dark: every menu item, every engagement and every tab in its panel.

   Run: node tests/click-through.js   (needs playwright and its Chromium) */
"use strict";
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const FIXTURE = fs.readFileSync(path.join(__dirname, "fixtures", "engagements.json"));
const TYPES = { ".html": "text/html", ".js": "application/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml" };
const PEOPLE = {
  assessor: { access: { "as-falcon": "write" }, name: "Test Assessor", email: "test@example.com" },
  admin: { access: { "as-falcon": "admin", "as-actualize": "admin", "as-vianteye": "admin" }, name: "Test Administrator", email: "test@mismo.org" },
  /* a MISMO administrator on their own screen (View As chooser, Help, System Health), 22 Nov 2026 */
  home: { platformAdmin: true, access: { "as-falcon": "admin", "as-actualize": "admin", "as-vianteye": "admin" }, name: "Test Administrator", email: "test@mismo.org" }
};

/* The shared Back-button helper (resources.mismo.org/assets/back.js, owned by Forms and shared pages) is tested as it
   is live, never copied here: MISMO_BACK can point at a local copy instead (for trying a change before it is published). */
let BACK = null;
async function backJs() {
  if (BACK !== null) return BACK;
  try {
    if (process.env.MISMO_BACK) BACK = fs.readFileSync(process.env.MISMO_BACK, "utf8");
    else { const r = await fetch("https://resources.mismo.org/assets/back.js"); BACK = r.ok ? await r.text() : ""; }
  } catch (e) { BACK = ""; }
  return BACK;
}

(async () => {
  const browser = await chromium.launch();
  let failures = 0, steps = 0, writes = 0;
  for (const who of Object.keys(PEOPLE)) for (const [width, scheme] of [[1400, "light"], [390, "dark"]]) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, colorScheme: scheme });
    const sess = Object.assign({ token: "t", expiresAt: new Date(Date.now() + 36e5).toISOString() }, PEOPLE[who]);
    await ctx.addInitScript(s => { try { sessionStorage.setItem("resources:service-orders:session", s); } catch (e) {} }, JSON.stringify(sess));
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", e => errs.push("script error: " + e.message));
    page.on("console", m => { if (m.type() === "error" && !/Failed to load resource|ERR_|net::/i.test(m.text())) errs.push("console: " + m.text()); });
    await page.route("**/*", async route => {
      const u = new URL(route.request().url());
      if (u.hostname === "resources.mismo.org") {
        if (u.pathname === "/assets/session.js") return route.fulfill({ contentType: "application/javascript", body: "window.ResourcesSession={token:()=>'t',requireAccess:()=>Promise.resolve(),mount:()=>{}};" });
        if (u.pathname === "/assets/back.js") return route.fulfill({ contentType: "application/javascript", body: await backJs() });
        if (u.pathname.startsWith("/assessors/")) {
          const f = path.join(ROOT, u.pathname.slice(11) || "index.html");
          if (fs.existsSync(f) && fs.statSync(f).isFile()) return route.fulfill({ contentType: TYPES[path.extname(f)] || "application/octet-stream", body: fs.readFileSync(f) });
        }
        return route.fulfill({ status: 404, body: "" });
      }
      if (/lambda-url\.[\w-]+\.on\.aws$/.test(u.hostname)) {
        if (route.request().method() !== "GET") { writes++; return route.fulfill({ status: 403, contentType: "application/json", body: '{"error":"VIEW_ONLY"}' }); }
        if (/^\/as-\w+\/file\/engagements\/\w+\.json$/.test(u.pathname) && !/-inbox\.json$/.test(u.pathname))
          return route.fulfill({ contentType: "application/json", body: JSON.stringify({ sha: "x", size: FIXTURE.length, content: FIXTURE.toString("base64") }) });
        return route.fulfill({ status: 404, contentType: "application/json", body: '{"error":"NOT_FOUND"}' });
      }
      if (/googleapis|gstatic/.test(u.hostname)) return route.fulfill({ status: 200, body: "" });
      return route.abort();
    });
    const tag = who + " " + width + "px " + scheme;
    const mark = name => { steps++; if (errs.length) { failures += errs.length; errs.splice(0).forEach(e => console.log("PROBLEM  " + tag + " @ " + name + ": " + e)); } };
    await page.goto("https://resources.mismo.org/assessors/" + (who === "admin" ? "?viewas=falcon" : ""));
    await page.waitForTimeout(2500);
    mark("load");
    const navs = await page.$$eval('.hq nav button[data-hq]', b => b.filter(x => !x.hidden).map(x => x.getAttribute("data-hq")));
    if (!navs.length) { failures++; console.log("PROBLEM  " + tag + ": no menu drawn (the page did not sign in)"); }
    for (const n of navs) {
      await page.evaluate(n => { const b = document.querySelector('.hq nav button[data-hq="' + n + '"]'); if (b) b.click(); }, n);
      await page.waitForTimeout(350); mark("menu " + n);
      const text = await page.evaluate(() => document.body.innerText);
      if (/\bNaN\b|undefined/.test(text)) { failures++; console.log("PROBLEM  " + tag + " @ menu " + n + ": the page shows NaN or undefined"); }
    }
    /* every engagement, every tab in its panel */
    await page.evaluate(() => { const b = document.querySelector('.hq nav button[data-hq="open"]'); if (b) b.click(); });
    await page.waitForTimeout(300);
    const rows = await page.$$eval("[data-open]", b => [...new Set(b.map(x => x.getAttribute("data-open")))]);
    for (const r of rows) {
      await page.evaluate(r => { const b = document.querySelector('[data-open="' + r + '"]'); if (b) b.click(); }, r);
      await page.waitForTimeout(300); mark("engagement " + r);
      const tabs = await page.$$eval('[role="tab"][data-ptab]', b => b.map(x => x.getAttribute("data-ptab")));
      for (const t of tabs) {
        await page.evaluate(t => { const b = document.querySelector('[role="tab"][data-ptab="' + t + '"]'); if (b) b.click(); }, t);
        await page.waitForTimeout(150); mark("engagement " + r + " tab " + t);
      }
      await page.keyboard.press("Escape");
      await page.evaluate(() => { const b = document.querySelector('.hq nav button[data-hq="open"]'); if (b) b.click(); });
      await page.waitForTimeout(150);
    }
    /* The browser's Back button (CN-033, Jonna, 25 Nov 2026), as an assessor at desktop width: two menu pages and Back
       returns to the first, Forward goes again; an engagement's panel and Back closes it and stays on the page; a panel
       closed with its X leaves no step behind. Real clicks: only what a person does makes a step. */
    if (who === "assessor" && width === 1400) {
      const problem = msg => { failures++; console.log("PROBLEM  " + tag + " @ Back button: " + msg); };
      const state = () => page.evaluate(() => ({
        tab: (document.querySelector(".hq nav button[data-hq][aria-current]") || {}).dataset?.hq || "",
        panel: !!document.querySelector("#as-scrim.on"), helper: !!window.MismoBack }));
      const go = async n => { await page.click('.hq nav button[data-hq="' + n + '"]'); await page.waitForTimeout(500); };
      const back = async () => { await page.evaluate(() => history.back()); await page.waitForTimeout(700); };
      const openEng = async () => { await go("open"); await page.click("[data-open]"); await page.waitForTimeout(500); };
      await go("home"); await page.waitForTimeout(600);
      let st = await state();
      const start = st.tab;
      if (!st.helper) problem("the shared Back helper (/assets/back.js) did not load");
      else {
        await go("open"); await go("sched");
        await back(); st = await state(); if (st.tab !== "open") problem("Back from Your Schedule should land on Engagements: " + JSON.stringify(st));
        await page.evaluate(() => history.forward()); await page.waitForTimeout(700);
        st = await state(); if (st.tab !== "sched") problem("Forward should go to Your Schedule again: " + JSON.stringify(st));
        await back(); await back(); st = await state(); if (st.tab !== start) problem("Back to " + start + ": " + JSON.stringify(st));
        await openEng(); st = await state();
        if (!st.panel) problem("an engagement did not open in its panel");
        await back(); st = await state(); if (st.panel || st.tab !== "open") problem("Back should close the panel and stay on Engagements: " + JSON.stringify(st));
        await back(); st = await state(); if (st.tab !== start) problem("Back after the panel should go to the page before Engagements: " + JSON.stringify(st));
        await openEng();
        await page.click("#as-shut"); await page.waitForTimeout(500);
        if ((await state()).panel) problem("the X did not close the panel");
        await back(); st = await state(); if (st.tab !== start) problem("after closing the panel with its X, Back should go straight to the page before: " + JSON.stringify(st));
      }
      mark("Back button");
    }
    if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) { failures++; console.log("PROBLEM  " + tag + ": the page is wider than the screen"); }
    await ctx.close();
  }
  await browser.close();
  console.log(steps + " steps, " + failures + " problem(s)" + (writes ? ", " + writes + " save attempt(s) refused" : "") + ".");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
