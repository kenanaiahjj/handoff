import { createElement } from "react";

export default function NextImageTestMock({ alt, ...props }) {
  const imageProps = Object.fromEntries(Object.entries(props).filter(([name]) => name !== "unoptimized"));
  return createElement("img", { ...imageProps, alt });
}
