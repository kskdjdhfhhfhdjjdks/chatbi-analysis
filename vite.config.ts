import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import type { Plugin } from 'vite'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// ============================================================
// 本地开发用的 LLM 转发中间件
//
// 线上走 Netlify Function（netlify/functions/chat.mjs）；
// 本地如果直接 `vite dev`，没有 Netlify 运行时，这个中间件补上同一个入口：
//   POST /api/chat → 复用同一份 handler，行为与线上一模一样。
//
// 好处是「本地能跑」和「线上能跑」不依赖两套代码，
// 否则最容易出现的情况就是本地调通、上线 404。
// ============================================================
function llmProxyPlugin(env: Record<string, string>): Plugin {
  const pick = (key: string) => {
    if (!process.env[key] && env[key]) process.env[key] = env[key]
  }

  return {
    name: 'chatbi-llm-proxy',
    configureServer(server) {
      pick('DEEPSEEK_API_KEY')
      pick('DEEPSEEK_BASE_URL')
      pick('DEEPSEEK_MODEL')

      server.middlewares.use('/api/chat', async (req, res) => {
        try {
          const chunks: Buffer[] = []
          let bytes = 0
          for await (const chunk of req) {
            bytes += Buffer.byteLength(chunk)
            if (bytes > 100000) {
              res.statusCode = 413
              res.end(JSON.stringify({ ok: false, code: 'TOO_LARGE', error: '请求过大' }))
              return
            }
            chunks.push(Buffer.from(chunk as Buffer))
          }

          const request = new Request('http://localhost/api/chat', {
            method: req.method || 'GET',
            headers: {
              'content-type': 'application/json',
              'x-nf-client-connection-ip': req.socket.remoteAddress || 'local',
            },
            body: req.method === 'GET' || req.method === 'HEAD' ? undefined : Buffer.concat(chunks),
          })

          // 复用模块以保留限流状态；修改函数后重启开发服务器。
          const handlerUrl = pathToFileURL(path.resolve(process.cwd(), 'netlify/functions/chat.mjs'))
          const mod = await import(handlerUrl.href)
          const response: Response = await mod.default(request, { ip: req.socket.remoteAddress })

          res.statusCode = response.status
          res.setHeader('content-type', response.headers.get('content-type') || 'application/json')
          res.setHeader('cache-control', 'no-store')
          res.end(await response.text())
        } catch {
          res.statusCode = 500
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ ok: false, code: 'DEV_PROXY_ERROR', error: '本地代理异常，请检查服务端配置' }))
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [react(), tailwindcss(), llmProxyPlugin(env)],
    build: {
      chunkSizeWarningLimit: 1200,
    },
  }
})
