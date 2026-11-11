/**
 * 极简静态服务器 + 视频落盘接收器。
 *
 * 为什么需要它：项目里没有任何浏览器自动化依赖（不允许装 Puppeteer/Playwright），
 * 也没有 ffmpeg。所以录制走浏览器自带的 MediaRecorder，编码好的 Blob 用一次
 * POST 送到这里写盘 —— 同源，不需要 CORS，也不需要处理 headless 的下载目录。
 *
 *   GET  /*        静态服务 dist/（录制页面要跑在构建产物上，保证和交付一致）
 *   POST /save     请求体是视频二进制，?name=xx.mp4&frames=N
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve('dist');
const OUT = path.resolve('out');
fs.mkdirSync(OUT, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.srt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  const t0 = Date.now();

  if (req.method === 'POST') {
    if (u.pathname === '/save') {
      const name = (u.searchParams.get('name') || 'out.webm').replace(/[^\w.-]/g, '_');
      const frames = u.searchParams.get('frames') || '?';
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const buf = Buffer.concat(chunks);
        const dst = path.join(OUT, name);
        fs.writeFileSync(dst, buf);
        const mb = (buf.length / 1048576).toFixed(1);
        console.log(`[save] ${name}  ${mb} MB  frames=${frames}  ${Date.now() - t0}ms`);
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('ok');
      });
      return;
    }
    res.writeHead(404);
    res.end('no route');
    return;
  }

  let p = u.pathname === '/' ? '/index.html' : u.pathname;
  let fp = path.join(ROOT, decodeURIComponent(p));
  if (!fp.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  res.writeHead(200, {
    'content-type': MIME[path.extname(fp)] || 'application/octet-stream',
    'cache-control': 'no-store',
  });
  fs.createReadStream(fp).pipe(res);
});

const PORT = Number(process.env.PORT) || 4174;
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[recv] http://127.0.0.1:${PORT}/  (dist=${ROOT} → out=${OUT})`);
});
