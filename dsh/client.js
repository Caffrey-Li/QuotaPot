window.__ModuleLoader__.load({
  id: 'dsh-quotapot',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const channel = 'quotapot/request'

    function frameBridge() {
      window.QUOTAPOT_DSH = true
      const pending = new Map()
      let sequence = 0
      window.addEventListener('message', (event) => {
        const reply = event.data
        if (event.source !== parent || reply?.type !== 'quotapot:reply' || !pending.has(reply.id)) return
        const { resolve, reject } = pending.get(reply.id)
        pending.delete(reply.id)
        if (reply.error) reject(new Error(reply.error))
        else resolve(new Response(reply.value.body, {
          status: reply.value.status,
          headers: { 'content-type': reply.value.contentType },
        }))
      })
      window.fetch = (url, options = {}) => new Promise((resolve, reject) => {
        const id = ++sequence
        pending.set(id, { resolve, reject })
        parent.postMessage({ type: 'quotapot:request', id, payload: {
          url, method: options.method ?? 'GET', body: options.body ?? '',
        } }, '*')
      })
    }

    function Panel(ctx) {
      return function QuotaPotPanel() {
        const frame = React.useRef(null)
        const [document, setDocument] = React.useState('')
        const [error, setError] = React.useState('')
        const [retry, setRetry] = React.useState(0)
        React.useEffect(() => {
          const controller = new AbortController()
          async function call(payload) {
            const outcome = await ctx.connection.rpc.call('/api', channel, payload, controller.signal)
            if (!outcome.ok) throw new Error(outcome.error.message)
            return outcome.value
          }
          async function onRequest(event) {
            const current = frame.current?.contentWindow
            const request = event.data
            if (!current || event.source !== current || request?.type !== 'quotapot:request') return
            let reply
            try { reply = { value: await call(request.payload) } }
            catch (error) { reply = { error: error.message } }
            if (!controller.signal.aborted) current.postMessage({ type: 'quotapot:reply', id: request.id, ...reply }, '*')
          }
          window.addEventListener('message', onRequest)
          call({ method: 'GET', url: '/api/plugin-panel' }).then((result) => {
            if (result.status !== 200) throw new Error('QuotaPot 面板读取失败')
            if (!controller.signal.aborted) {
              const bridge = `<script>(${frameBridge.toString()})()</script>`
              setDocument(result.body.replace(/<script>/, (script) => bridge + script))
            }
          }).catch((error) => {
            if (!controller.signal.aborted) setError(error.message)
          })
          return () => {
            controller.abort()
            window.removeEventListener('message', onRequest)
          }
        }, [retry])

        if (error) return h('section', { style: { padding: 'var(--dsh-frame-top-clearance, 24px) 24px 12px' } },
          h('p', { role: 'alert' }, error),
          h('button', { type: 'button', onClick: () => { setError(''); setRetry(retry + 1) } }, '重试'))
        if (!document) return h('p', { role: 'status', style: { padding: 'var(--dsh-frame-top-clearance, 24px) 24px' } }, '正在打开 QuotaPot…')
        return h('section', { style: {
          height: '100%', minHeight: 0, paddingTop: 'var(--dsh-frame-top-clearance, 0px)', boxSizing: 'border-box',
        } }, h('iframe', {
          ref: frame, title: 'QuotaPot', srcDoc: document, sandbox: 'allow-scripts',
          style: { border: 0, width: '100%', height: '100%', display: 'block' },
        }))
      }
    }

    return {
      inject: ['slots', 'connection'],
      apply(ctx) {
        const id = 'quotapot'
        const Icon = () => h('span', { 'aria-hidden': true, style: { fontWeight: 700 } }, 'Q')
        ctx.effect(() => ctx.slots.inject('main', () =>
          ctx.slots.register({ name: 'main', key: id }, Panel(ctx))))
        ctx.effect(() => ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register({ name: 'sidebar.panellist', id, label: () => 'QuotaPot' }, Icon)))
      },
    }
  },
})
