"use client";

import { useState } from "react";
import {
  configurableRoleLabels,
  configurableRoles,
  roleFeatureDetails,
  roleFeatureKeys,
  type ConfigurableRole,
  type RoleFeature,
  type RoleFeatureSettings,
} from "@/src/lib/role-features";
import { showErrorToast, showToast } from "./Toaster";

type Props = { workspaceId: string; settings: RoleFeatureSettings };

/** Owner settings: which canvas features each role gets. Each switch saves right away. */
export function RoleFeaturesForm({ workspaceId, settings: initial }: Props) {
  const [settings, setSettings] = useState(initial);
  const [saving, setSaving] = useState<string | null>(null);

  // Optimistic: the switch flips now and flips back if the server couldn't save it.
  async function toggle(role: ConfigurableRole, feature: RoleFeature) {
    const previous = settings;
    const next = { ...settings, [role]: { ...settings[role], [feature]: !settings[role][feature] } };
    setSettings(next);
    setSaving(`${role}:${feature}`);
    const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/role-features`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(next),
    }).catch(() => null);
    setSaving(null);
    if (!response?.ok) {
      setSettings(previous);
      showErrorToast("Couldn't save. Try again.");
      return;
    }
    showToast(`${roleFeatureDetails[feature].label} ${next[role][feature] ? "on" : "off"} for ${configurableRoleLabels[role]}`);
  }

  return (
    <section aria-labelledby="settings-role-features" className="workspace-pane p-5 sm:p-6">
      <h2 className="text-[14px] font-semibold text-foreground" id="settings-role-features">Features by role</h2>
      <p className="mt-1.5 text-[13px] leading-5 text-foreground-muted">
        Choose what each role can do on the canvas. Owners and product designers always have everything. Search, comments and navigation stay on for everyone.
      </p>
      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[460px] border-separate border-spacing-0 text-left">
          <thead>
            <tr>
              <th className="pb-2 text-[12px] font-medium text-foreground-subtle" scope="col">Feature</th>
              {configurableRoles.map((role) => (
                <th className="w-20 pb-2 text-center text-[12px] font-medium text-foreground-subtle" key={role} scope="col">{configurableRoleLabels[role]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {roleFeatureKeys.map((feature) => (
              <tr key={feature}>
                <th className="border-t border-white/[0.06] py-3 pr-4 align-top font-normal" scope="row">
                  <span className="block text-[13px] font-medium text-foreground">{roleFeatureDetails[feature].label}</span>
                  <span className="mt-0.5 block text-[12px] leading-[18px] text-foreground-subtle">{roleFeatureDetails[feature].description}</span>
                </th>
                {configurableRoles.map((role) => {
                  const on = settings[role][feature];
                  return (
                    <td className="border-t border-white/[0.06] py-3 text-center align-top" key={role}>
                      <button
                        aria-checked={on}
                        aria-label={`${roleFeatureDetails[feature].label} for ${configurableRoleLabels[role]}`}
                        className={"relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60 " + (on ? "bg-[#e3a13a]" : "bg-white/[0.12]")}
                        disabled={saving !== null}
                        onClick={() => void toggle(role, feature)}
                        role="switch"
                        type="button"
                      >
                        <span aria-hidden="true" className={"absolute left-0.5 size-4 rounded-full shadow-[0_1px_2px_rgb(0_0_0/0.4)] transition-transform " + (on ? "translate-x-4 bg-white" : "translate-x-0 bg-white/70")} />
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
