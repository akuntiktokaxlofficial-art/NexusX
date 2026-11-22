// api/proxy.js
// Serverless function di Vercel: ambil halaman asli dari app.dripwire.cc,
// lalu ganti teks nama/judul sebelum dikirim ke pengunjung.

const TARGET_ORIGIN = "https://app.dripwire.cc";

// ====== GANTI BAGIAN INI SESUAI KEINGINAN ======
const NEW_NAME = "NEXUS XIT";
const REPLACEMENTS = [
  // [teks lama, teks baru]
  ["DRIP WIRE", NEW_NAME],
  ["Drip Wire", NEW_NAME],
  ["dripwire", NEW_NAME.toLowerCase()],
];
// ================================================

export default async function handler(req, res) {
  try {
    const path = req.url === "/" ? "/" : req.url;
    const targetUrl = TARGET_ORIGIN + path;

    const upstream = await fetch(targetUrl, {
      method: req.method,
      headers: {
        // teruskan beberapa header penting, tapi jangan teruskan host asli
        "User-Agent": req.headers["user-agent"] || "Mozilla/5.0",
        "Accept": req.headers["accept"] || "*/*",
        "Cookie": req.headers["cookie"] || "",
      },
      body: ["GET", "HEAD"].includes(req.method) ? undefined : req.body,
      redirect: "manual",
    });

    const contentType = upstream.headers.get("content-type") || "";

    // Teruskan cookie dari upstream (supaya login tetap jalan)
    const setCookie = upstream.headers.get("set-cookie");
    if (setCookie) res.setHeader("set-cookie", setCookie);

    // Kalau upstream redirect, ikuti tapi tetap di domain kita
    if ([301, 302, 303, 307, 308].includes(upstream.status)) {
      const location = upstream.headers.get("location") || "/";
      const relative = location.replace(TARGET_ORIGIN, "");
      res.writeHead(upstream.status, { Location: relative });
      return res.end();
    }

    if (contentType.includes("text/html")) {
      let html = await upstream.text();

      // Ganti semua kemunculan nama lama dengan nama baru
      for (const [oldText, newText] of REPLACEMENTS) {
        html = html.split(oldText).join(newText);
      }

      res.setHeader("content-type", "text/html; charset=utf-8");
      return res.status(upstream.status).send(html);
    }

    // Untuk file non-HTML (JS, CSS, gambar, dsb) teruskan apa adanya
    const buffer = Buffer.from(await upstream.arrayBuffer());
    res.setHeader("content-type", contentType);
    return res.status(upstream.status).send(buffer);
  } catch (err) {
    res.status(500).send("Proxy error: " + err.message);
  }
}
