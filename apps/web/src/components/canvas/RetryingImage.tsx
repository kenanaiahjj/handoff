"use client";

import Image, { type ImageProps } from "next/image";
import type { CSSProperties } from "react";
import { useRetryingImage } from "./use-retrying-image";

function FailedImage({ label, style, className, exhausted, onRetry }: {
  label: string;
  style?: CSSProperties;
  className?: string;
  exhausted: boolean;
  onRetry: () => void;
}) {
  return (
    <div
      className={(className ?? "") + " grid place-items-center border border-dashed border-white/20 bg-white/[0.03] text-center text-foreground-muted"}
      role="img"
      aria-label={label + (exhausted ? " didn’t load" : " is loading again")}
      style={style}
    >
      <span className="pointer-events-auto grid max-w-[90%] gap-2 text-[12px] leading-5">
        <span>{exhausted ? "This screen’s image didn’t load." : "Loading this screen’s image again…"}</span>
        {exhausted ? (
          <button className="dial-button mx-auto min-h-8 px-3 text-[11px]" onClick={onRetry} type="button">Retry</button>
        ) : null}
      </span>
    </div>
  );
}

/** A canvas render that retries on its own and shows a clear placeholder instead of a broken image. */
export function RetryingCanvasImage(props: ImageProps & { src: string; alt: string }) {
  const image = useRetryingImage(props.src);
  if (image.failed) {
    return <FailedImage className={props.className} exhausted={image.exhausted} label={props.alt} onRetry={image.retryNow} style={props.style} />;
  }
  return <Image {...props} alt={props.alt} onError={image.onError} src={image.src} />;
}

/** The phone view's plain image with the same recovery. */
export function RetryingImg(props: React.ImgHTMLAttributes<HTMLImageElement> & { src: string; alt: string }) {
  const image = useRetryingImage(props.src);
  if (image.failed) {
    return (
      <FailedImage
        className={props.className}
        exhausted={image.exhausted}
        label={props.alt}
        onRetry={image.retryNow}
        style={{ aspectRatio: props.width && props.height ? `${props.width} / ${props.height}` : undefined, ...props.style }}
      />
    );
  }
  // eslint-disable-next-line @next/next/no-img-element -- served by our cached asset route.
  return <img {...props} alt={props.alt} onError={image.onError} src={image.src} />;
}
