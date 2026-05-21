import { exportToBlob, exportToSvg } from "@excalidraw/excalidraw";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

async function triggerDownload(
  blob: Blob,
  filename: string,
) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function downloadBoardAsPng(api: ExcalidrawImperativeAPI) {
  const elements = api.getSceneElements();
  const appState = api.getAppState();
  const files = api.getFiles();

  try {
    const blob = await exportToBlob({
      elements,
      appState: {
        ...appState,
        exportWithDarkMode: false,
        exportBackground: true,
      },
      files,
      mimeType: "image/png",
      getDimensions: (_w: number, _h: number) => ({ width: _w, height: _h, scale: 2 }),
    });
    await triggerDownload(blob, "board.png");
  } catch (err) {
    console.error("Failed to export PNG:", err);
  }
}

export async function downloadBoardAsSvg(api: ExcalidrawImperativeAPI) {
  const elements = api.getSceneElements();
  const appState = api.getAppState();
  const files = api.getFiles();

  try {
    const svg = await exportToSvg({
      elements,
      appState: {
        ...appState,
        exportWithDarkMode: false,
        exportBackground: true,
      },
      files,
    });

    const svgString = svg.outerHTML;
    const blob = new Blob([svgString], { type: "image/svg+xml" });
    await triggerDownload(blob, "board.svg");
  } catch (err) {
    console.error("Failed to export SVG:", err);
  }
}
