"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface CanvasTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

const MIN_SCALE = 0.08;
const MAX_SCALE = 5;

export function useCanvasViewport(frameWidth: number, frameHeight: number) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [transform, setTransform] = useState<CanvasTransform>({
    scale: 0.3,
    offsetX: 0,
    offsetY: 0,
  });

  const fitToFrame = useCallback(() => {
    const container = containerRef.current;
    if (!container || frameWidth <= 0 || frameHeight <= 0) return;

    container.scrollLeft = 0;
    container.scrollTop = 0;
    const rect = container.getBoundingClientRect();
    const availableWidth = Math.max(1, rect.width - 72);
    const availableHeight = Math.max(1, rect.height - 72);
    const scale = Math.max(
      MIN_SCALE,
      Math.min(1, availableWidth / frameWidth, availableHeight / frameHeight),
    );

    setTransform({ scale, offsetX: 0, offsetY: 0 });
  }, [frameHeight, frameWidth]);

  useEffect(() => {
    fitToFrame();
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver((entries) => {
      const contentRect = entries[0]?.contentRect;
      if (contentRect) {
        const nextSize = { width: contentRect.width, height: contentRect.height };
        setViewportSize((current) => current.width === nextSize.width && current.height === nextSize.height ? current : nextSize);
      }
      fitToFrame();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [fitToFrame]);

  const zoomBy = useCallback((factor: number) => {
    setTransform((current) => ({
      ...current,
      scale: Math.max(MIN_SCALE, Math.min(MAX_SCALE, current.scale * factor)),
    }));
  }, []);

  const zoomAt = useCallback((factor: number, point: { x: number; y: number }) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const center = { x: rect.width / 2, y: rect.height / 2 };
    const pointer = { x: point.x - rect.left, y: point.y - rect.top };

    setTransform((current) => {
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, current.scale * factor));
      const contentPoint = {
        x: (pointer.x - center.x - current.offsetX) / current.scale,
        y: (pointer.y - center.y - current.offsetY) / current.scale,
      };

      return {
        scale,
        offsetX: pointer.x - center.x - contentPoint.x * scale,
        offsetY: pointer.y - center.y - contentPoint.y * scale,
      };
    });
  }, []);

  const panBy = useCallback((deltaX: number, deltaY: number) => {
    setTransform((current) => ({
      ...current,
      offsetX: current.offsetX + deltaX,
      offsetY: current.offsetY + deltaY,
    }));
  }, []);

  return {
    containerRef,
    viewportSize,
    transform,
    fitToFrame,
    zoomBy,
    zoomAt,
    panBy,
  };
}
