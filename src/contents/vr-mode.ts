import type { PlasmoCSConfig } from "plasmo"

export const config: PlasmoCSConfig = {
  matches: ["<all_urls>"],
  run_at: "document_idle",
}

// VR mode will be injected by the popup via chrome.scripting.executeScript
// This file serves as the entry point for the VR activation logic

async function initVR() {
  const video = document.querySelector("video")
  if (!video) {
    alert("No <video> element found on this page.")
    return
  }

  // Check if already in VR mode
  if (document.getElementById("web-vr-container")) {
    return
  }

  // TODO: Inject Three.js and create VR scene
  console.log("VR mode activated for video element:", video.currentSrc || video.src || "blob/MSE source")
}

initVR()
