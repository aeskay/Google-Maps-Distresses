/**
 * PlotlyChart.jsx
 * Thin Plotly wrapper that lazy-loads plotly.js-dist-min.
 * Configured with a squarer export aspect ratio (~1.56:1, 780x500) for downloaded images
 * while keeping the wide responsive view on the website.
 */
import React, { useEffect, useRef, useImperativeHandle, forwardRef, useCallback } from 'react';

let Plotly = null;

async function getPlotly() {
  if (!Plotly) {
    Plotly = (await import('plotly.js-dist-min')).default;
  }
  return Plotly;
}

const PlotlyChart = forwardRef(function PlotlyChart({
  data,
  layout,
  config,
  style,
  filename,
  exportWidth = 780,
  exportHeight = 500,
  exportScale = 2,
}, ref) {
  const containerRef = useRef(null);

  const handleDownload = useCallback(async (customFilename) => {
    const el = containerRef.current;
    if (!el) return;
    const P = await getPlotly();

    const currentLayout = el.layout || layout || {};
    const origMargin = { ...(currentLayout.margin || {}) };
    const origLegend = { ...(currentLayout.legend || {}) };

    // Calculate export layout parameters
    const targetW = exportWidth;
    const targetH = exportHeight;
    const exportMarginB = 100;
    const exportMarginT = typeof origMargin.t === 'number' ? origMargin.t : 45;
    const exportPlotH = Math.max(targetH - exportMarginT - exportMarginB, 100);

    // ~68px below axis line gives ~20px gap below 'Year' title
    const exportLegendY = -Math.round((68 / exportPlotH) * 1000) / 1000;

    const isBottomLegend =
      origLegend.orientation === 'h' &&
      origLegend.yanchor === 'top' &&
      typeof origLegend.y === 'number' &&
      origLegend.y < 0;

    const exportRelayout = isBottomLegend
      ? {
          'margin.b': exportMarginB,
          'margin.t': exportMarginT,
          'legend.y': exportLegendY,
        }
      : {};

    const restoreRelayout = isBottomLegend
      ? {
          'margin.b': origMargin.b,
          'margin.t': origMargin.t,
          'legend.y': origLegend.y,
        }
      : {};

    try {
      if (isBottomLegend) {
        await P.relayout(el, exportRelayout);
      }

      await P.downloadImage(el, {
        format: 'png',
        width: targetW,
        height: targetH,
        scale: exportScale,
        filename: customFilename || filename || 'chart',
      });
    } finally {
      if (isBottomLegend) {
        await P.relayout(el, restoreRelayout);
      }
    }
  }, [layout, filename, exportWidth, exportHeight, exportScale]);

  const handleCopy = useCallback(async () => {
    const el = containerRef.current;
    if (!el) return false;
    const P = await getPlotly();

    const currentLayout = el.layout || layout || {};
    const origMargin = { ...(currentLayout.margin || {}) };
    const origLegend = { ...(currentLayout.legend || {}) };

    const targetW = exportWidth;
    const targetH = exportHeight;
    const exportMarginB = 100;
    const exportMarginT = typeof origMargin.t === 'number' ? origMargin.t : 45;
    const exportPlotH = Math.max(targetH - exportMarginT - exportMarginB, 100);

    const exportLegendY = -Math.round((68 / exportPlotH) * 1000) / 1000;

    const isBottomLegend =
      origLegend.orientation === 'h' &&
      origLegend.yanchor === 'top' &&
      typeof origLegend.y === 'number' &&
      origLegend.y < 0;

    const exportRelayout = isBottomLegend
      ? {
          'margin.b': exportMarginB,
          'margin.t': exportMarginT,
          'legend.y': exportLegendY,
        }
      : {};

    const restoreRelayout = isBottomLegend
      ? {
          'margin.b': origMargin.b,
          'margin.t': origMargin.t,
          'legend.y': origLegend.y,
        }
      : {};

    try {
      if (isBottomLegend) {
        await P.relayout(el, exportRelayout);
      }

      const dataUrl = await P.toImage(el, {
        format: 'png',
        width: targetW,
        height: targetH,
        scale: exportScale,
      });

      const res = await fetch(dataUrl);
      const blob = await res.blob();

      if (navigator.clipboard && window.ClipboardItem) {
        await navigator.clipboard.write([
          new window.ClipboardItem({ 'image/png': blob }),
        ]);
        return true;
      } else {
        throw new Error('Clipboard API not supported in this browser.');
      }
    } finally {
      if (isBottomLegend) {
        await P.relayout(el, restoreRelayout);
      }
    }
  }, [layout, exportWidth, exportHeight, exportScale]);

  useImperativeHandle(ref, () => ({
    download: handleDownload,
    downloadImage: handleDownload,
    copyImage: handleCopy,
    copyImageToClipboard: handleCopy,
    getElement: () => containerRef.current,
  }), [handleDownload, handleCopy]);

  useEffect(() => {
    let mounted = true;
    const el = containerRef.current;
    if (!el || !data || !layout) return;

    getPlotly().then(P => {
      if (!mounted || !containerRef.current) return;

      const cameraIcon = P.Icons?.camera || {
        width: 1000,
        height: 1000,
        path: 'M500 450c-83 0-150-67-150-150 0-83 67-150 150-150 83 0 150 67 150 150 0 83-67 150-150 150zm350-250h-100l-50-100h-400l-50 100h-100c-55 0-100 45-100 100v450c0 55 45 100 100 100h700c55 0 100-45 100-100v-450c0-55-45-100-100-100z',
      };

      const clipboardIcon = {
        width: 1000,
        height: 1000,
        path: 'M350 100 A50 50 0 0 1 400 50 L600 50 A50 50 0 0 1 650 100 L780 100 A40 40 0 0 1 820 140 L820 900 A40 40 0 0 1 780 940 L220 940 A40 40 0 0 1 180 900 L180 140 A40 40 0 0 1 220 100 Z M400 130 L600 130 L600 90 L400 90 Z M300 360 L700 360 M300 520 L700 520 M300 680 L700 680',
      };

      const mergedConfig = {
        responsive: true,
        displayModeBar: true,
        modeBarButtons: [
          [
            {
              name: 'copyChartPNG',
              title: 'Copy chart image to clipboard',
              icon: clipboardIcon,
              click: () => {
                handleCopy();
              },
            },
            {
              name: 'downloadCompactPNG',
              title: 'Download chart as PNG',
              icon: cameraIcon,
              click: () => {
                handleDownload();
              },
            },
            'zoom2d',
            'pan2d',
            'zoomIn2d',
            'zoomOut2d',
            'resetScale2d',
          ],
        ],
        toImageButtonOptions: {
          format: 'png',
          scale: exportScale,
          width: exportWidth,
          height: exportHeight,
          filename: filename || 'chart',
        },
        ...(config || {}),
      };

      P.react(el, data, layout, mergedConfig);
    });

    return () => { mounted = false; };
  }, [data, layout, config, handleDownload, exportWidth, exportHeight, exportScale, filename]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', minHeight: 390, ...style }}
    />
  );
});

export default PlotlyChart;
