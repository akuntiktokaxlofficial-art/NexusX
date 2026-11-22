// language: JavaScript, file: api/proxy.js, runtime: Vercel Node 20

const TARGET_ORIGIN = "https://app.dripwire.cc";
const NEW_NAME = "NEXUS XIT";

const REPLACEMENTS = [
  ["DRIP WIRE", NEW_NAME],
  ["Drip Wire", NEW_NAME],
  ["dripwire", NEW_NAME.toLowerCase()],
];

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
  return cookie.replace(/;\s*domain=[^;]*/gi, "");
}

function buildClientScript() {
  return `<script>(function(){
  var ORIGIN = ${JSON.stringify(TARGET_ORIGIN)};
  var REPLACEMENTS = ${JSON.stringify(REPLACEMENTS)};

  // 1. BELOKKAN SEMUA REQUEST (Fetch, XHR, Axios) KE DOMAIN KITA
  function rewriteUrl(u) {
    if (typeof u !== "string") return u;
    try {
      // Kalau URL-nya ngarah ke dripwire, potong domainnya biar relative ke proxy kita
      if (u.includes("dripwire.cc")) {
        var urlObj = new URL(u, window.location.origin);
        return urlObj.pathname + urlObj.search + urlObj.hash;
      }
    } catch (e) {}
    return u;
  }

  var _fetch = window.fetch;
  window.fetch = function(input, init) {
    try {
      if (typeof input === "string") {
        input = rewriteUrl(input);
      } else if (input && input.url) {
        var newUrl = rewriteUrl(input.url);
        if (newUrl !== input.url) {
          input = new Request(newUrl, input);
        }
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

  if (navigator.sendBeacon) {
    var _beacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = function(u, d) { return _beacon(rewriteUrl(u), d); };
  }

  // 2. CEGAH DITENDANG BALIK KE HALAMAN DEPAN DARI DALAM SCRIPT
  var _pushState = history.pushState;
  history.pushState = function() {
    if (arguments[2] === "/" || arguments[2] === "") return;
    return _pushState.apply(this, arguments);
  };

  // 3. GANTI TEKS DI LAYAR
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
  // Handle CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    return res.end();
  }

  try {
    let path = req.query.path || "";
    
    // Redirect root
    if (path === "" || path === "/" || path === "index.html") {
      res.writeHead(302, { Location: "/home", "Cache-Control": "no-store" });
      return res.end();
    }

    // Rekonstruksi URL
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query)) {
      if (key !== "path") searchParams.append(key, value);
    }
    const query = searchParams.toString() ? `?${searchParams.toString()}` : "";
    const targetUrl = `${TARGET_ORIGIN}/${path}${query}`;

    // Teruskan header
    const fwd = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (!["host", "connection", "content-length", "accept-encoding"].includes(key.toLowerCase())) {
        fwd[key] = value;
      }
    }
    
    fwd["origin"] = TARGET_ORIGIN;
    if (req.headers["referer"]) {
      const ourOrigin = `https://${req.headers["host"]}`;
      fwd["referer"] = req.headers["referer"].replace(ourOrigin, TARGET_ORIGIN);
    }

    // Handle Body (Benerin Form & JSON)
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
        // Vercel udah parse body-nya
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

    // Teruskan Cookie
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

    // Redirect dari upstream
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
      return res.end(html);
    }

    const buf = Buffer.from(await upstream.arrayBuffer());
    res.statusCode = upstream.status;
    res.setHeader("content-type", ct || "application/octet-stream");
    for (const h of ["cache-control", "etag", "last-modified"]) {
      const v = upstream.headers.get(h);
      if (v) res.setHeader(h, v);
    }
    return res.end(buf);
    
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("content-type", "text/plain; charset=utf-8");
    return res.end("proxy error: " + (err && err.message ? err.message : String(err)));
  }
}
