"use client";

export function StartHandoffButton() {
  function focusHandoffSetup() {
    const firstField = document.querySelector<HTMLInputElement>(
      "#setup-handoff-name, #setup-version-label",
    );
    firstField?.focus();
  }

  return (
    <button
      className="capture-primary-action inline-flex min-h-11 items-center rounded-control px-5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      onClick={focusHandoffSetup}
      type="button"
    >
      Start handoff
    </button>
  );
}
