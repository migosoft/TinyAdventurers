import { chromium } from 'playwright-core';
import { gpuLaunch, gpuOn } from './gpu.mjs';
const b = await chromium.launch({ executablePath: '/usr/bin/brave-browser', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'], ...(gpuOn ? gpuLaunch() : {}) });
const p = await b.newPage({ viewport: { width: 1280, height: 768 } });
p.on('pageerror', (e) => console.log('PAGEERROR', e.message.slice(0, 1500)));
p.on('console', (m) => console.log(m.type(), m.text().slice(0, 2500)));
await p.addInitScript(() => {
  const P = WebGL2RenderingContext.prototype, orig = P.linkProgram;
  P.linkProgram = function (pr) {
    orig.call(this, pr);
    if (!this.getProgramParameter(pr, this.LINK_STATUS)) {
      console.error('LINKLOG [' + (this.getProgramInfoLog(pr) || '') + '] lost=' + this.isContextLost());
      for (const sh of this.getAttachedShaders(pr) || []) {
        const src = this.getShaderSource(sh) || '';
        console.error('SH type=' + this.getShaderParameter(sh, this.SHADER_TYPE) + ' ok=' + this.getShaderParameter(sh, this.COMPILE_STATUS) + ' len=' + src.length + ' log=[' + (this.getShaderInfoLog(sh) || '').slice(0, 800) + ']');
      }
    }
  };
});
await p.goto(process.argv[2]);
await p.waitForTimeout(Number(process.argv[3] ?? 25000));
console.log('frames', await p.evaluate(() => [window.__r3d?.frames, window.__r3d?.backend]));
console.log((await p.evaluate(() => document.body.innerText)).slice(0, 600));
await b.close();
