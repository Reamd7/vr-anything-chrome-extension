import vrCode from "data-text:./injected/vr-mode.ts"
import siteConfig from "./siteConfig.json"

type SiteEntry = { selector: string; }

/**
 * Match hostname against config keys.
 * Priority: exact hostname > wildcard (*.example.com) > "*"
 */
function matchSiteConfig(hostname: string): SiteEntry | undefined {
  const config = siteConfig as Record<string, SiteEntry>
  // 1. exact hostname match (e.g. "www.youtube.com")
  if (config[hostname]) return config[hostname]
  // 2. wildcard match (e.g. "*.youtube.com" matches "www.youtube.com")
  const wildcardHit = Object.keys(config).find((key) => {
    if (!key.startsWith("*.")) return false
    return hostname.endsWith(key.slice(1)) || hostname === key.slice(2)
  })
  if (wildcardHit) return config[wildcardHit]
  // 3. global fallback
  return config["*"]
}

interface VideoScanResult {
  selector: string
  src: string
  playing: boolean
}

interface ActiveCheckResult {
  active: boolean
  frameId?: number
}

const SCAN_FUNC = (sel: string) => {
  const found: VideoScanResult[] = []
  document.querySelectorAll(sel).forEach((v) => {
    const el = v as HTMLVideoElement
    if (el.readyState >= 2) {
      found.push({
        selector: sel,
        src: el.currentSrc || el.src || "",
        playing: !el.paused,
      })
    }
  })
  return found.find((v) => v.playing) || found[0] || null
}

const FULLSCREEN_IFRAME_FUNC = () => {
  document.querySelectorAll("iframe").forEach((iframe) => {
    const el = iframe as HTMLIFrameElement
    el.dataset.__webVrOrigStyle = el.getAttribute("style") || ""
    el.setAttribute(
      "style",
      "position:fixed!important;top:0!important;left:0!important;" +
        "width:100vw!important;height:100vh!important;z-index:2147483646!important;" +
        "border:none!important;margin:0!important;padding:0!important;background:#000!important;"
    )
  })
  document.body.dataset.__webVrOrigOverflow = document.body.style.overflow
  document.body.style.overflow = "hidden"
}

const RESTORE_IFRAME_FUNC = () => {
  document.querySelectorAll("iframe").forEach((iframe) => {
    const el = iframe as HTMLIFrameElement
    if (el.dataset.__webVrOrigStyle !== undefined) {
      el.setAttribute("style", el.dataset.__webVrOrigStyle)
      delete el.dataset.__webVrOrigStyle
    }
  })
  if (document.body.dataset.__webVrOrigOverflow !== undefined) {
    document.body.style.overflow = document.body.dataset.__webVrOrigOverflow
    delete document.body.dataset.__webVrOrigOverflow
  }
}

const CHECK_ACTIVE_FUNC = (): ActiveCheckResult => {
  if ((window as any).__webVRActive) return { active: true }
  return { active: false }
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id || !tab.url) return
  const tabId = tab.id

  const hostname = new URL(tab.url).hostname
  const cfg = matchSiteConfig(hostname)
  const selector = cfg?.selector || "video"

  // Check if VR is already active
  const checkResults = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    world: "MAIN",
    func: CHECK_ACTIVE_FUNC,
  })

  const activeHit = checkResults.find(
    (r) => (r.result as ActiveCheckResult)?.active === true
  )

  if (activeHit) {
    // --- Deactivate ---
    const frameId = (activeHit.result as ActiveCheckResult).frameId ?? activeHit.frameId
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      world: "MAIN",
      func: () => { (window as any).__webVRCleanup?.() },
    })
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: RESTORE_IFRAME_FUNC,
    })
    return
  }

  // --- Activate: find video ---
  const scan = async (sel: string) => {
    const results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      world: "MAIN",
      func: SCAN_FUNC,
      args: [sel],
    })
    const hits: { frameId: number; selector: string; playing: boolean }[] = []
    for (const r of results) {
      const v = r.result as VideoScanResult | null
      if (v) hits.push({ frameId: r.frameId, selector: v.selector, playing: v.playing })
    }
    return hits.find((v) => v.playing) || hits[0] || null
  }

  let video = await scan(selector)
  if (!video && selector !== "video") video = await scan("video")
  if (!video) return

  // Fullscreen iframe if needed
  if (video.frameId !== 0) {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: FULLSCREEN_IFRAME_FUNC,
    })
  }

  // Inject VR
  await chrome.scripting.executeScript({
    target: { tabId, frameIds: [video.frameId] },
    world: "MAIN",
    func: (code: string, sel: string, m: string) => {
      const cfg = { selector: sel, mode: m }
      ;(window as any).__webVRConfig = cfg
      if (typeof (window as any).__webVRInit === "function") {
        ;(window as any).__webVRInit(cfg)
      } else {
        ;(0, eval)(code)
      }
    },
    args: [vrCode, video.selector, "360"],
  })
})

// --- Handle "Enter VR" button clicks from content script ---
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.action !== "enter-vr" || !sender.tab?.id) return

  const tabId = sender.tab.id
  const frameId = sender.frameId ?? 0
  const selector = message.selector as string

  ;(async () => {
    // Fullscreen iframe if needed
    if (frameId !== 0) {
      await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: FULLSCREEN_IFRAME_FUNC,
      })
    }

    // Inject VR — cleanup existing VR first if active in this frame
    await chrome.scripting.executeScript({
      target: { tabId, frameIds: [frameId] },
      world: "MAIN",
      func: (code: string, sel: string, m: string) => {
        if (
          (window as any).__webVRActive &&
          typeof (window as any).__webVRCleanup === "function"
        ) {
          ;(window as any).__webVRCleanup()
        }
        const cfg = { selector: sel, mode: m }
        ;(window as any).__webVRConfig = cfg
        if (typeof (window as any).__webVRInit === "function") {
          ;(window as any).__webVRInit(cfg)
        } else {
          ;(0, eval)(code)
        }
      },
      args: [vrCode, selector, "360"],
    })
  })()
})

export {}
