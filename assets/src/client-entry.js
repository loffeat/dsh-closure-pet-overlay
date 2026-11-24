// dsh-closure-pet — 客户端 bundle 入口
//
// 构建后由 DSH 的 client-modules 以 /plugins/dsh-closure-pet/client.js 提供；
// 真正 UI 在 main.js，打包进同一个 bundle，不再从宿主路由动态 import。

import { startPet } from './main.js'

export function makeFactory() {
  return function factory(require) {
    var React = require('react')
    var current = null

    function PetLayer() {
      var ref = React.useRef(null)
      React.useEffect(function () {
        var node = ref.current
        if (!node) return
        var mountEl = document.createElement('div')
        mountEl.id = 'dsh-closure-pet-mount'
        // display:contents：不参与布局，子元素（position:fixed 的桌宠）仍相对视口
        mountEl.style.cssText = 'display:contents'
        node.appendChild(mountEl)
        current = startPet(mountEl)

        return function () {
          var dispose = current
          current = null
          if (typeof dispose === 'function') {
            try { dispose() } catch (err) {}
          }
          if (mountEl.parentNode) mountEl.parentNode.removeChild(mountEl)
        }
      }, [])

      return React.createElement('div', {
        ref: ref,
        style: { position: 'fixed', left: 0, top: 0, width: 0, height: 0, overflow: 'visible', pointerEvents: 'none' },
      })
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('shell.overlay', function () {
          return ctx.slots.register({
            name: 'shell.overlay',
            id: 'dsh-closure-pet',
            order: 100,
          }, PetLayer)
        })
      },
    }
  }
}

window.__ModuleLoader__.load({
  id: 'dsh-closure-pet',
  factory: makeFactory(),
})
