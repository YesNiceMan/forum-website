// Vercel / Serverless 入口：不监听端口，直接把请求转给 server/index.mjs 里的 handle(req, res)
// 本地开发用 npm start（node server/index.mjs），两条路共用同一套路由。
import { handle, store, DATA, UPLOADS } from '../server/index.mjs';

export default async function handler(req, res) {
  try {
    await handle(req, res);
  } catch (err) {
    console.error('[api] 未捕获异常：', err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: false, error: 'server_error', message: String((err && err.message) || err) }));
    } else {
      try { res.end(); } catch {}
    }
  }
  // 响应已发出，但这次请求可能改了数据；实例随时会被冻结，所以现在就落盘
  if (store._timer) {
    try { await store.drain(); } catch (err) { console.error('[api] 落盘失败：', err.message); }
  }
}

export { DATA, UPLOADS };
