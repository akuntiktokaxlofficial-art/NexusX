// language: JavaScript, file: api/proxy.js, runtime: Vercel Node 20

const TARGET_ORIGIN = "https://app.dripwire.cc";
const NEW_NAME = "NEXUS XIT"; // GANTI NAMA DI SINI

const REPLACEMENTS = [
  ["DRIP WIRE", NEW_NAME],
  ["Drip Wire", NEW_NAME],
  ["dripwire", NEW_NAME.toLowerCase()],
];

const DROP_RESPONSE_HEADERS = new Set([
  "content-security-policy",
  "content-security-policy-report-only",
  "x-frame-options",
  "content-length",
  "content-encoding",
  "transfer-encoding",
  "connection",
  "strict-transport-security", 
]);

function renameInHtmlTextNodes(html) {
  return html.replace(
    /(<script\b[^>]*>[\s\S]*?<\/script>)|(<style\b[^>]*>[\s\S]*?<\/style>)|(<[^>]*>)|([^<]+)/gi,
    (m, _s, _st, _tag, text) => {
      if (text === undefined) return m;
      let out = text;
      for (const [oldT, newT] of REPLACEMENTS) {
        if (out.indexOf(oldT) !== -1) out = out.split(oldT).join(newT);
      }
      return out;
    }
  );
}

function relativizeUpstreamUrls(html) {
  const esc = TARGET_ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html
    .replace(new RegExp(`(href|src|action)=["']${esc}([^"']*)["']`, "gi"), (_m, attr, rest) => `${attr}="${rest || "/"}"`)
    .replace(new RegExp(`https?:\\/\\/app\\.dripwire\\.cc`, "g"), "");
}

function stripCookieDomain(cookie) {
  let c = cookie.replace(/;\s*domain=[^;]*/gi, "");
  if (!/samesite=/i.test(c)) c += "; SameSite=None";
  if (!/secure/i.test(c)) c += "; Secure";
  if (!/path=/i.test(c)) c += "; Path=/";
  return c;
}

function buildClientScript() {
  return `
  <!-- ERUDA CONSOLE BUAT IPHONE -->
  <script src="https://cdn.jsdelivr.net/npm/eruda"></script>
  <script>eruda.init();</script>
  
  <script>(function(){
  var REPLACEMENTS = ${JSON.stringify(REPLACEMENTS)};
  var FAKE_JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

  // 1. SUNTIK LOCALSTORAGE & COOKIE
  try {
    localStorage.setItem('token', FAKE_JWT);
    localStorage.setItem('auth', 'true');
    localStorage.setItem('isLoggedIn', 'true');
    localStorage.setItem('key', 'VALID-KEY');
    document.cookie = "token=" + FAKE_JWT + "; path=/";
  } catch (e) {}

  var _getItem = Storage.prototype.getItem;
  Storage.prototype.getItem = function(key) {
    var val = _getItem.call(this, key);
    if (/token|auth|key|login|session/i.test(key) && (!val || val === "null" || val === "false" || val === "")) {
       return key.toLowerCase().includes("token") ? FAKE_JWT : "true";
    }
    return val;
  };

  // 2. BLOKIR REDIRECT KE LOGIN
  function isLoginUrl(url) {
    if (typeof url !== "string") return false;
    return url === "/" || url.endsWith("/login") || url.includes("/login?");
  }
  
  var _replace = location.replace.bind(location);
  location.replace = function(url) {
    if (isLoginUrl(url)) { console.log("Blocked replace to login"); return; }
    return _replace(url);
  };

  // 3. LOG & PALSUKAN API
  var _fetch = window.fetch;
  window.fetch = function(input, init) {
    var url = typeof input === "string" ? input : (input ? input.url : "");
    console.log("FETCH:", url);
    
    if (/verify|auth|login|check|validate|session/i.test(url)) {
      console.log("FAKING SUCCESS FOR:", url);
      
      // PAKSA PINDAH KE /HOME
      setTimeout(function() {
          console.log("Redirecting to /home...");
          window.location.href = "/home";
      }, 1000);

      return Promise.resolve(new Response(JSON.stringify({
        status: "success", 
        valid: true, 
        token: FAKE_JWT,
        data: { token: FAKE_JWT, status: "success" },
        message: "Login Berhasil"
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }

    if (init) init.credentials = 'include';
    else init = { credentials: 'include' };
    try {
      if (typeof input === "string" && input.includes("dripwire.cc")) input = new URL(input, location.origin).pathname;
      else if (input && input.url && input.url.includes("dripwire.cc")) input = new Request(new URL(input.url, location.origin).pathname, input);
    } catch (e) {}
    return _fetch.call(this, input, init);
  };

  // 4. GANTI TEKS
  function renameText(t) {
    for (var i = 0; i < REPLACEMENTS.length; i++) {
      if (t.indexOf(REPLACEMENTS[i][0]) !== -1) t = t.split(REPLACEMENTS[i][0]).join(REPLACEMENTS[i][1]);
    }
    return t;
  }
  function walk(node) {
    if (!node) return;
    if (node.nodeType === 3) { var nv = node.nodeValue, out = renameText(nv); if (out !== nv) node.nodeValue = out; return; }
    if (node.nodeType !== 1 || node.tagName === "SCRIPT" || node.tagName === "STYLE") return;
    for (var i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]);
  }
  if (document.body) walk(document.body);
  document.addEventListener("DOMContentLoaded", function () { if (document.body) walk(document.body); });
  new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      var m = muts[i];
      if (m.type === "characterData") walk(m.target);
      else for (var j = 0; j < m.addedNodes.length; j++) walk(m.addedNodes[j]);
    }
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
})();</script>`;
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    let path = (req.query.path || "").replace(/^\/+/, "");
    
    if (!path) {
      res.writeHead(302, { Location: "/home", "Cache-Control": "no-store" });
      return res.end();
    }

    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query)) {
      if (key !== "path") searchParams.append(key, value);
    }
    const query = searchParams.toString() ? `?${searchParams.toString()}` : "";
    const targetUrl = `${TARGET_ORIGIN}/${path}${query}`;

    const fwd = {};
    for (const [key, value] of Object.entries(req.headers)) {
      const k = key.toLowerCase();
      if (["host", "connection", "content-length", "accept-encoding"].includes(k)) continue;
      fwd[k] = value;
    }
    fwd["origin"] = TARGET_ORIGIN;
    if (req.headers["referer"]) {
      fwd["referer"] = req.headers["referer"].replace(`https://${req.headers["host"]}`, TARGET_ORIGIN);
    }

    let body;
    if (!["GET", "HEAD"].includes(req.method)) {
      if (req.body === undefined) {
        body = await new Promise((resolve, reject) => {
          const chunks = [];
          req.on("data", (c) => chunks.push(c));
          req.on("end", () => resolve(Buffer.concat(chunks)));
          req.on("error", reject);
        });
      } else if (Buffer.isBuffer(req.body) || typeof req.body === "string") {
        body = req.body;
      } else {
        const ct = req.headers["content-type"] || "";
        if (ct.includes("application/x-www-form-urlencoded")) body = new URLSearchParams(req.body).toString();
        else { body = JSON.stringify(req.body); if (!fwd["content-type"]) fwd["content-type"] = "application/json"; }
      }
    }

    const upstream = await fetch(targetUrl, { method: req.method, headers: fwd, body, redirect: "manual" });

    let setCookies = [];
    if (typeof upstream.headers.getSetCookie === "function") setCookies = upstream.headers.getSetCookie();
    else { const single = upstream.headers.get("set-cookie"); if (single) setCookies = [single]; }
    if (setCookies.length) res.setHeader("set-cookie", setCookies.map(stripCookieDomain));

    if ([301, 302, 303, 307, 308].includes(upstream.status)) {
      const loc = upstream.headers.get("location") || "/";
      const rel = loc.startsWith(TARGET_ORIGIN) ? loc.slice(TARGET_ORIGIN.length) || "/" : loc;
      
      if (rel === "/" || rel === "" || rel.includes("login")) {
        res.writeHead(302, { Location: "/home", "Cache-Control": "no-store" });
        return res.end();
      }
      res.writeHead(upstream.status, { Location: rel, "Cache-Control": "no-store" });
      return res.end();
    }

    const ct = upstream.headers.get("content-type") || "";

    if (ct.includes("text/html")) {
      let html = await upstream.text();
      html = relativizeUpstreamUrls(html);
      html = renameInHtmlTextNodes(html);
      
      const script = buildClientScript();
      html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, () => script + "</body>") : html + script;

      res.statusCode = upstream.status;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.setHeader("cache-control", "private, no-store, max-age=0, must-revalidate");
      
      for (const [k, v] of upstream.headers) {
        if (DROP_RESPONSE_HEADERS.has(k.toLowerCase()) || k.toLowerCase() === "set-cookie") continue;
        res.setHeader(k, v);
      }
      return res.end(html);
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    res.statusCode = upstream.status;
    res.setHeader("content-type", ct || "application/octet-stream");
    for (const [k, v] of upstream.headers) {
      if (DROP_RESPONSE_HEADERS.has(k.toLowerCase()) || k.toLowerCase() === "set-cookie") continue;
      res.setHeader(k, v);
    }
    return res.end(buf);

  } catch (err) {
    res.statusCode = 502;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    return res.end("proxy error: " + (err && err.message ? err.message : String(err)));
  }
}
