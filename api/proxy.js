// language: JavaScript, file: api/proxy.js, runtime: Vercel Node 20, target: Node fetch + raw res

const TARGET_ORIGIN = "https://app.dripwire.cc";
const NEW_NAME = "NEXUS XIT";

const REPLACEMENTS = [
  ["DRIP WIRE", NEW_NAME],
  ["Drip Wire", NEW_NAME],
  ["dripwire", NEW_NAME.toLowerCase()],
];

// Ganti hanya di text node: lewati <tag ...>, <script>…</script>, <style>…</style>.
// Atribut (href, src, class, id) tidak disentuh supaya asset dan route tidak 404.
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

// Buang Domain= supaya cookie menempel ke host proxy, bukan app.dripwire.cc.
function stripCookieDomain(cookie) {
  return cookie.replace(/;\s*domain=[^;]*/gi, "");
}

// Script client: ganti teks yang dirender JS + belokkan fetch ke origin sendiri
// supaya tetap lewat proxy. Blokir pendaftaran service worker.
function buildClientScript() {
  return `<script>(function(){
  var ORIGIN = ${JSON.stringify(TARGET_ORIGIN)};
  var PROTO_REL = ORIGIN.replace(/^https?:/, "");
  var REPLACEMENTS = ${JSON.stringify(REPLACEMENTS)};

  function rewriteUrl(u) {
    if (typeof u !== "string") return u;
    if (u.indexOf(ORIGIN) === 0) return u.slice(ORIGIN.length) || "/";
    if (u.indexOf(PROTO_REL) === 0) return u.slice(PROTO_REL.length) || "/";
    return u;
  }

  var _fetch = window.fetch;
  window.fetch = function(input, init) {
    try {
      if (typeof input === "string") input = rewriteUrl(input);
      else if (input && input.url) input = new Request(rewriteUrl(input.url), input);
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

  if (navigator.serviceWorker) {
    try {
      navigator.serviceWorker.register = function() {
        return Promise.reject(new Error("service worker blocked by proxy"));
      };
    } catch (e) {}
  }

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
    var tag = node.tagName;
    if (tag === "SCRIPT" || tag === "STYLE") return;
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
  }).observe(document.documentElement, {
    childList: true, subtree: true, characterData: true
  });
})();</script>`;
}

export default async function handler(req, res) {
  try {
    const rawUrl = req.url || "/";

    // ====== 1. AUTO REDIRECT KE /home ======
    // Kalau buka halaman depan (root), langsung lempar ke /home
    if (rawUrl === "/" || rawUrl === "/index.html") {
      res.statusCode = 302;
      res.setHeader("location", "/home");
      return res.end();
    }

    // Jaga akses langsung ke endpoint proxy
    if (rawUrl === "/api/proxy" || rawUrl.startsWith("/api/proxy?")) {
      res.statusCode = 404;
      return res.end("not found");
    }

    const targetUrl = TARGET_ORIGIN + rawUrl;

    // ====== 2. FORWARD HEADERS ======
    const fwd = {};
    for (const h of [
      "user-agent", "accept", "accept-language", "content-type",
      "authorization", "cache-control",
    ]) {
      if (req.headers[h]) fwd[h] = req.headers[h];
    }
    if (req.headers["cookie"]) fwd["cookie"] = req.headers["cookie"];
    fwd["origin"] = TARGET_ORIGIN;
    if (req.headers["referer"]) {
      const ourOrigin =
        (req.headers["x-forwarded-proto"] || "https") + "://" + req.headers["host"];
      fwd["referer"] = req.headers["referer"].split(ourOrigin).join(TARGET_ORIGIN);
    }

    // ====== 3. BODY ======
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
        body = JSON.stringify(req.body);
        if (!fwd["content-type"]) fwd["content-type"] = "application/json";
      }
    }

    // ====== 4. FETCH UPSTREAM ======
    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: fwd,
      body,
      redirect: "manual",
    });

    // ====== 5. SET-COOKIE ======
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

    // ====== 6. REDIRECTS ======
    if ([301, 302, 303, 307, 308].includes(upstream.status)) {
      const loc = upstream.headers.get("location") || "/";
      const rel = loc.startsWith(TARGET_ORIGIN)
        ? loc.slice(TARGET_ORIGIN.length) || "/"
        : loc;
      res.statusCode = upstream.status;
      res.setHeader("location", rel);
      return res.end();
    }

    const ct = upstream.headers.get("content-type") || "";

    // ====== 7. HTML PROCESSING ======
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
      res.setHeader("cache-control", "private, no-store");
      return res.end(html);
    }

    // ====== 8. NON-HTML PASSTHROUGH ======
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
