import { mount, unmount } from "svelte";
import App from "./app/App.svelte";
import DemoPage from "./features/demo/DemoPage.svelte";
import EntryPage from "./features/demo/EntryPage.svelte";
import { isStandalonePwa } from "./shared/pwa/detection";
import { registerPushServiceWorker } from "./shared/pwa/push";

document.documentElement.classList.toggle("is-standalone", isStandalonePwa());

if ("serviceWorker" in navigator) {
  void registerPushServiceWorker().catch((error) =>
    console.warn("[pwa] service worker registration failed", error),
  );
}

const target = document.getElementById("root");
if (!target) throw new Error("Missing #root element");

function pageForRoute() {
  const route = window.location.hash.replace(/^#\/?/, "");
  return route === "entry" ? EntryPage : route === "demo" ? DemoPage : App;
}

let currentPage = pageForRoute();
let currentInstance = mount(currentPage, { target });

window.addEventListener("hashchange", () => {
  const nextPage = pageForRoute();
  if (nextPage === currentPage) return;

  currentPage = nextPage;
  void unmount(currentInstance).then(() => {
    currentInstance = mount(currentPage, { target });
  });
});
