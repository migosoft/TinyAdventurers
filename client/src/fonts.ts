export const FONT_TEXT = "'Inter', system-ui, sans-serif";
export const FONT_HEAD = "'IM Fell English SC', Georgia, serif";

const FACES = ['400 16px Inter', '600 16px Inter', '800 16px Inter', 'italic 600 16px Inter', '16px "IM Fell English SC"'];

/** Loads every face Phaser draws with, so canvas text never renders in a fallback. Never rejects; gives up after timeoutMs. */
export async function loadFonts(fonts: FontFaceSet | undefined = typeof document !== 'undefined' ? document.fonts : undefined, timeoutMs = 3000): Promise<void> {
  if (!fonts?.load) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  const all = Promise.all(FACES.map((f) => fonts.load(f))).then(
    () => {},
    () => {},
  );
  await Promise.race([all, timeout]);
  clearTimeout(timer);
}
