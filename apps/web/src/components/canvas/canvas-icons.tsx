import type { SVGProps } from "react";

/** Small 16px line icons for the canvas toolbar and panel. Decorative: labels live on the buttons. */
function Icon({ children, ...props }: SVGProps<SVGSVGElement>) {
  return (
    <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.4" viewBox="0 0 16 16" width="16" {...props}>
      {children}
    </svg>
  );
}

export const HandIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}><path d="M5.5 8V3.6a1 1 0 0 1 2 0V7.5m0-4.6a1 1 0 0 1 2 0v4.6m0-3.6a1 1 0 0 1 2 0V8.5m0-2.6a1 1 0 0 1 2 0v3.6c0 2.6-1.9 4.5-4.4 4.5h-.7c-1.4 0-2.4-.6-3.2-1.7L3 9.6a1 1 0 0 1 1.6-1.2l.9 1.1" /></Icon>
);
export const CursorIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}><path d="m3.5 2.5 9 4-3.8 1.4L7.3 12 3.5 2.5Z" /></Icon>
);
export const MarqueeIcon = (props: SVGProps<SVGSVGElement>) => (
  // A dashed selection box with the pointer at its corner.
  <Icon {...props}><path d="M2.5 9V3.5a1 1 0 0 1 1-1H9" strokeDasharray="1.8 1.6" /><path d="m8 8 5.5 2.3-2.2.8-.8 2.2L8 8Z" /></Icon>
);
export const CommentIcon =(props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}><path d="M3 11.8V4.5A1.5 1.5 0 0 1 4.5 3h7A1.5 1.5 0 0 1 13 4.5v5a1.5 1.5 0 0 1-1.5 1.5H5.4L3 12.8Z" /></Icon>
);
export const NoteIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}><path d="M4 2.8h8v10.4H4zM6 5.5h4M6 8h4M6 10.5h2" /></Icon>
);
export const OutlineIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}><rect height="10" rx="1" strokeDasharray="2 1.6" width="10" x="3" y="3" /></Icon>
);
export const GridIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}><path d="M5.7 2.5v11M10.3 2.5v11M2.5 5.7h11M2.5 10.3h11" /></Icon>
);
export const ChangesIcon = (props: SVGProps<SVGSVGElement>) => (
  // An element with a "changed" dot on its corner.
  <Icon {...props}><path d="M9 4H4a1.5 1.5 0 0 0-1.5 1.5v6A1.5 1.5 0 0 0 4 13h6a1.5 1.5 0 0 0 1.5-1.5V7" /><circle cx="12.2" cy="3.8" fill="currentColor" r="1.8" stroke="none" /></Icon>
);
export const MoreIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}><circle cx="3.5" cy="8" fill="currentColor" r=".9" stroke="none" /><circle cx="8" cy="8" fill="currentColor" r=".9" stroke="none" /><circle cx="12.5" cy="8" fill="currentColor" r=".9" stroke="none" /></Icon>
);
export const KeyboardIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}><rect height="8" rx="1.5" width="12" x="2" y="4" /><path d="M4.5 6.5h.01M7 6.5h.01M9.5 6.5h.01M12 6.5h-.5M5.5 9.5h5" /></Icon>
);
export const CompareIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}><rect height="9" rx="1" width="5" x="2.5" y="3.5" /><rect height="9" rx="1" width="5" x="8.5" y="3.5" /></Icon>
);
export const InspectIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}><path d="M2.5 5V3.5a1 1 0 0 1 1-1H5M11 2.5h1.5a1 1 0 0 1 1 1V5M13.5 11v1.5a1 1 0 0 1-1 1H11M5 13.5H3.5a1 1 0 0 1-1-1V11" /><rect height="5" rx=".5" width="5" x="5.5" y="5.5" /></Icon>
);
export const VersionIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}><circle cx="8" cy="8" r="5.5" /><path d="M8 5v3l2 1.3" /></Icon>
);
export const InfoIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}><circle cx="8" cy="8" r="5.5" /><path d="M8 7.3v3.5M8 5.2v.1" /></Icon>
);
export const ChevronDownIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}><path d="m4.5 6.5 3.5 3.5 3.5-3.5" /></Icon>
);
export const PanelLeftIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}><rect height="10" rx="1.5" width="12" x="2" y="3" /><path d="M6 3v10" /></Icon>
);
export const PanelRightIcon = (props: SVGProps<SVGSVGElement>) => (
  <Icon {...props}><rect height="10" rx="1.5" width="12" x="2" y="3" /><path d="M10 3v10" /></Icon>
);
