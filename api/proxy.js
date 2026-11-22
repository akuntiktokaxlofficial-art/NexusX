// language: JavaScript, file: api/proxy.js, runtime: Vercel Node 20

const TARGET_ORIGIN = "https://app.dripwire.cc";
const NEW_NAME = "NEXUS XIT";

const REPLACEMENTS = [
  ["DRIP WIRE", NEW_NAME],
  ["Drip Wire", NEW_NAME],
  ["dripwire", NEW_NAME.toLowerCase()],
];

// Header yang dibuang biar CSS & script injeksi kita nggak diblokir sama server asli
const DROP_RESPONSE_HEADERS = new Set([
  "content-security-policy", "content-security-policy-report-only", "x-frame-options",
  "content-length", "content-encoding", "transfer-encoding", "connection", "strict-transport-security",
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

function stripCookieDomain(cookie) {
  let c = cookie.replace(/;\s*domain=[^;]*/gi, "");
  if (!/samesite=/i.test(c)) c += "; SameSite=None";
  if (!/secure/i.test(c)) c += "; Secure";
  if (!/path=/i.test(c)) c += "; Path=/";
  return c;
}

function buildClientScript() {
  return `
  <style>
  /* OVERRIDE WARNA UNGU JADI MERAH */
  :root {
    --primary: #ef4444 !important;
    --primary-color: #ef4444 !important;
    --accent: #dc2626 !important;
    --purple: #ef4444 !important;
  }
  .bg-purple-500, .bg-purple-600, .bg-purple-700, .bg-violet-500, .bg-violet-600, 
  [style*="#a855f7"], [style*="#8b5cf6"], [style*="#7c3aed"] {
    background-color: #ef4444 !important;
    border-color: #ef4444 !important;
  }
  .text-purple-400, .text-purple-500, .text-purple-600, .text-violet-400, .text-violet-500 {
    color: #ef4444 !important;
  }
  .border-purple-500, .border-purple-600, .border-violet-500 {
    border-color: #ef4444 !important;
  }
  [style*="box-shadow: 0 0 20px #a855f7"] {
    box-shadow: 0 0 20px #ef4444 !important;
  }
  </style>

  <script>(function(){
  var REPLACEMENTS = ${JSON.stringify(REPLACEMENTS)};

  // BELOKKAN SEMUA REQUEST API KE PROXY KITA (Biar Cookie / Session jalan normal)
  function rewriteUrl(u) {
    if (typeof u !== "string") return u;
    try {
      if (u.includes("dripwire.cc")) {
        var urlObj = new URL(u, window.location.origin);
        return urlObj.pathname + urlObj.search + urlObj.hash;
      }
    } catch (e) {}
    return u;
  }

  var _fetch = window.fetch;
  window.fetch = function(input, init) {
    if (init) init.credentials = 'include';
    else init = { credentials: 'include' };
    try {
      if (typeof input === "string") input = rewriteUrl(input);
      else if (input && input.url) {
        var newUrl = rewriteUrl(input.url);
        if (newUrl !== input.url) input = new Request(newUrl, input);
      }
    } catch (e) {}
    return _fetch.call(this, input, init);
  };

  var _open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(m, u) {
    var a = [].slice.call(arguments);
    a[1] = rewriteUrl(u);
    return _open.apply(this, a);
  };

  // GANTI TEKS
  function renameText(t) {
    for (var i = 0; i < REPLACEMENTS.length; i++) {
      var p = REPLACEMENTS[i];
      if (t.indexOf(p[0]) !== -1) t = t.split(p[0]).join(p[1]);
    }
    return t;
  }

  function walk(node) {
    if (!node) return;
    if (node.nodeType === 3) {
      var nv = node.nodeValue;
      var out = renameText(nv);
      if (out !== nv) node.nodeValue = out;
      return;
    }
    if (node.nodeType !== 1) return;
    if (node.tagName === "SCRIPT" || node.tagName === "STYLE") return;
    for (var i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]);
  }

  function renameTitle() {
    var t = document.title;
    var out = renameText(t);
    if (out !== t) document.title = out;
  }

  var dirty = new Set();
  var pending = false;
  function flush() {
    pending = false;
    renameTitle();
    var arr = [];
    for (var n of dirty) if (n.isConnected) arr.push(n);
    dirty.clear();
    for (var i = 0; i < arr.length; i++) walk(arr[i]);
  }

  if (document.body) walk(document.body);
  document.addEventListener("DOMContentLoaded", function () {
    if (document.body) walk(document.body);
  });

  new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      var m = muts[i];
      if (m.type === "characterData") dirty.add(m.target);
      else for (var j = 0; j < m.addedNodes.length; j++) dirty.add(m.addedNodes[j]);
    }
    if (!pending) { pending = true; requestAnimationFrame(flush); }
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
})();</script>`;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  try {
    let path = req.query.path || "";
    
    // (Logika tendang ke /home udah DIHAPUS. Biarin root nampilin halaman asli)

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
      const ourOrigin = `https://${req.headers["host"]}`;
      fwd["referer"] = req.headers["referer"].replace(ourOrigin, TARGET_ORIGIN);
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
        const contentType = req.headers["content-type"] || "";
        if (contentType.includes("application/x-www-form-urlencoded")) {
          body = new URLSearchParams(req.body).toString();
        } else {
          body = JSON.stringify(req.body);
          if (!fwd["content-type"]) fwd["content-type"] = "application/json";
        }
      }
    }

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: fwd,
      body,
      redirect: "manual",
    });

    let setCookies = [];
    if (typeof upstream.headers.getSetCookie === "function") {
      setCookies = upstream.headers.getSetCookie();
    } else {
      const single = upstream.headers.get("set-cookie");
      if (single) setCookies = [single];
    }
    if (setCookies.length) {
      res.setHeader("set-cookie", setCookies.map(stripCookieDomain));
    }

    // (Logika Bypass redirect udah DIHAPUS. Teruskan redirect apa adanya)
    if ([301, 302, 303, 307, 308].includes(upstream.status)) {
      const loc = upstream.headers.get("location") || "/";
      const rel = loc.startsWith(TARGET_ORIGIN) ? loc.slice(TARGET_ORIGIN.length) || "/" : loc;
      res.writeHead(upstream.status, { Location: rel, "Cache-Control": "no-store" });
      return res.end();
    }

    const ct = upstream.headers.get("content-type") || "";

    if (ct.includes("text/html")) {
      let html = await upstream.text();
      html = renameInHtmlTextNodes(html);
      
      const script = buildClientScript();
      if (/<\/body>/i.test(html)) {
        html = html.replace(/<\/body>/i, () => script + "</body>");
      } else {
        html += script;
      }
      
      res.statusCode = upstream.status;
      res.setHeader("content-type", "text/html; charset=utf-8");
      res.setHeader("cache-control", "private, no-store, max-age=0, must-revalidate");
      
      for (const [k, v] of upstream.headers) {
        if (!DROP_RESPONSE_HEADERS.has(k.toLowerCase()) && k.toLowerCase() !== "set-cookie") res.setHeader(k, v);
      }
      return res.end(html);
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    res.statusCode = upstream.status;
    res.setHeader("content-type", ct || "application/octet-stream");
    
    for (const [k, v] of upstream.headers) {
      if (!DROP_RESPONSE_HEADERS.has(k.toLowerCase()) && k.toLowerCase() !== "set-cookie") res.setHeader(k, v);
    }
    return res.end(buf);
    
  } catch (err) {
    res.statusCode = 502;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    return res.end("proxy error: " + (err && err.message ? err.message : String(err)));
  }
}
