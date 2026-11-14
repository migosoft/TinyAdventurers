// GPU=1 for the r3d scripts: a visible Brave window on the discrete card (NVIDIA driver 595 on the dev notebook), WebGL2 and WebGPU.
// GPU=uncapped also lifts the frame limit (for frame-rate figures). Without GPU the scripts keep their headless SwiftShader launch.
export const gpuOn = !!process.env.GPU;

/** Launch options for `chromium.launch` when GPU is set: headed, the ANGLE-over-Vulkan start line and the env that picks the NVIDIA card. */
export function gpuLaunch() {
  const args = ['--use-angle=vulkan', '--enable-features=Vulkan,DefaultANGLEVulkan,VulkanFromANGLE', '--enable-unsafe-webgpu', '--ozone-platform=x11'];
  if (process.env.GPU === 'uncapped') args.push('--disable-gpu-vsync', '--disable-frame-rate-limit');
  return { headless: false, args, env: { ...process.env, __VK_LAYER_NV_optimus: 'NVIDIA_only' } };
}

/** Prints which GPU draws: the WebGL renderer string and the WebGPU adapter's info. */
export async function printGpu(page) {
  const info = await page.evaluate(async () => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const ext = gl?.getExtension('WEBGL_debug_renderer_info');
    const webgl = gl ? (ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : 'none';
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
