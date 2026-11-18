/** Review status labels and colours, shared by server pages and client controls. */
export type HandoffReviewStatus = "draft" | "in_review" | "approved";

export const handoffStatusMeta: Record<HandoffReviewStatus, { label: string; hint: string; dot: string; chip: string }> = {
  draft: { label: "Draft", hint: "Still being designed", dot: "bg-foreground-subtle", chip: "bg-white/[0.06] text-foreground-muted" },
  in_review: { label: "In review", hint: "Waiting on reviewers", dot: "bg-[#efae3d]", chip: "bg-[#43331f] text-[#efae3d]" },
  approved: { label: "Approved", hint: "Signed off, ready to build", dot: "bg-success", chip: "bg-[#183a2d] text-success" },
};
