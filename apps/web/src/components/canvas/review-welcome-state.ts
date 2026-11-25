/**
 * Remembers, per review link, which version this browser has been welcomed to. A plain module so the
 * server page can read the name too (exports of "use client" files are client references there).
 */
export const reviewWelcomeCookie = "asbir-review-seen";
