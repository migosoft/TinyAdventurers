// GPU=1 for the r3d scripts: a visible Brave window on the discrete card (NVIDIA driver 595 on the dev notebook), WebGL2 and WebGPU.
// GPU=uncapped also lifts the frame limit (for frame-rate figures). Without GPU the scripts keep their headless SwiftShader launch.
import { chromium } from 'playwright-core';
export const gpuOn = !!process.env.GPU;

/** What a software renderer or adapter calls itself. */
export const SOFTWARE = /swiftshader|llvmpipe|softpipe|software/i;

/**
 * The one browser start of the e2e scripts: BROWSER (default: the Windows Edge path, or Brave on Linux), headless unless HEADED=1, and the flags of `mode`:
 * webgl = SwiftShader GL, webgpu = SwiftShader Vulkan (HEADED=1: the real GPU). GPU=1 replaces all of it with `gpuLaunch()`.
 */
export function launch(mode = 'webgl') {
  const headed = !!process.env.HEADED;
  const args = mode !== 'webgpu'
    ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader']
    : headed
      ? ['--enable-unsafe-webgpu', '--enable-features=Vulkan']
      : ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader'];
  const executablePath = process.env.BROWSER ?? (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : '/usr/bin/brave-browser');
  return chromium.launch({ executablePath, headless: !headed, args, ...(gpuOn ? gpuLaunch() : {}) });
}

/** Samples requestAnimationFrame for `secs` seconds: { mean, med, p99 } frame times in ms. */
export function sampleFrames(page, secs) {
  return page.evaluate((secs) => new Promise((res) => {
    const ts = [];
    const t0 = performance.now();
    const f = (t) => {
      ts.push(t);
      if (t - t0 < secs * 1000) return requestAnimationFrame(f);
      const d = ts.slice(1).map((v, i) => v - ts[i]).sort((a, c) => a - c);
      res({ mean: (ts[ts.length - 1] - ts[0]) / (ts.length - 1), med: d[d.length >> 1], p99: d[Math.floor(d.length * 0.99)] });
    };
    requestAnimationFrame(f);
  }), secs);
}

/** Launch options for `chromium.launch` when GPU is set: headed, the ANGLE-over-Vulkan start line and the env that picks the NVIDIA card. */
export function gpuLaunch() {
  const args = ['--use-angle=vulkan', '--enable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE', '--enable-unsafe-webgpu', '--ozone-platform=x11'];
  // An occluded or background window gets about one animation frame a second: keep it drawing at full rate.
  args.push('--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling');
  if (process.env.GPU === 'uncapped') args.push('--disable-gpu-vsync', '--disable-frame-rate-limit');
  return { headless: false, args, env: { ...process.env, __VK_LAYER_NV_optimus: 'NVIDIA_only' } };
}

/** Prints which GPU draws: the WebGL renderer string and the WebGPU adapter's info. */
export async function printGpu(page) {
  const info = await page.evaluate(async () => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    const webgl = gl ? (ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : 'none';
    // Free the context now (#366): left to the garbage collector, its teardown later waits up to ~330 ms for the busy GPU process, in a measured frame.
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    let webgpu = 'none';
    try {
      const a = await navigator.gpu?.requestAdapter();
      if (a) webgpu = [a.info?.vendor, a.info?.architecture, a.info?.device, a.info?.description].filter(Boolean).join(' ') || 'adapter without info';
    } catch (e) {
      webgpu = `error: ${e.message}`;
    }
    return { webgl, webgpu };
  });
  console.log(`gpu: WebGL2 ${info.webgl}; WebGPU ${info.webgpu}`);
}
