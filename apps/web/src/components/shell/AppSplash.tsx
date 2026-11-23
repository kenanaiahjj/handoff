import Image from "next/image";
import Script from "next/script";

/**
 * Opening animation shown once per browser session when the app starts. It is plain CSS
 * (see `.app-splash` in globals.css), so it paints with the first HTML and never blocks the
 * page underneath from loading. The inline script hides it on later full page loads.
 */
export function AppSplash() {
  return (
    <>
      <div aria-hidden="true" className="app-splash">
        <div className="app-splash-mark">
          <Image alt="" className="app-splash-logo" height={56} priority src="/icons/asbir-handoff-v4-192.png" width={56} />
        </div>
      </div>
      {/* Rendered from the root layout, which is where the App Router allows beforeInteractive. */}
      {/* eslint-disable-next-line @next/next/no-before-interactive-script-outside-document */}
      <Script id="asbir-splash-session" strategy="beforeInteractive">
        {"try{if(sessionStorage.getItem('asbir-splash')){document.documentElement.dataset.splash='seen'}else{sessionStorage.setItem('asbir-splash','1')}}catch(e){}"}
      </Script>
    </>
  );
}
