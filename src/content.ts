export const config = {
  matches: ["<all_urls>"],
  all_frames: true,
  run_at: "document_idle",
}

const ATTR_ID = "data-webvr-id"
let counter = 0

const tracked = new WeakMap<
  HTMLVideoElement,
  { btn: HTMLElement; alive: boolean; timer: ReturnType<typeof setInterval> }
>()

function addVRButton(video: HTMLVideoElement) {
  if (tracked.has(video)) return

  const id = `webvr-${counter++}`
  video.setAttribute(ATTR_ID, id)

  const btn = document.createElement("div")
  btn.textContent = "🥽 VR"
  btn.setAttribute("data-webvr-btn", id)
  Object.assign(btn.style, {
    position: "fixed",
    zIndex: "2147483645",
    padding: "5px 12px",
    background: "rgba(0,0,0,0.65)",
    color: "#fff",
    borderRadius: "16px",
    fontSize: "12px",
    lineHeight: "1.4",
    cursor: "pointer",
    fontFamily: "system-ui, -apple-system, sans-serif",
    userSelect: "none",
    transition: "opacity 0.2s, background 0.15s",
    opacity: "0.85",
    display: "none",
    whiteSpace: "nowrap",
  } as Partial<CSSStyleDeclaration>)

  btn.addEventListener("mouseenter", () => {
    btn.style.background = "rgba(25,118,210,0.9)"
  })
  btn.addEventListener("mouseleave", () => {
    btn.style.background = "rgba(0,0,0,0.65)"
  })

  document.body.appendChild(btn)

  const entry = { btn, alive: true, timer: null as any }
  tracked.set(video, entry)

  function update() {
    if (!entry.alive) return
    if (!video.isConnected) {
      cleanup()
      return
    }
    const rect = video.getBoundingClientRect()
    const vrActive = !!document.getElementById("web-vr-container")
    const hidden =
      rect.width < 30 ||
      rect.height < 30 ||
      video.style.display === "none" ||
      vrActive

    if (hidden) {
      btn.style.display = "none"
    } else {
      btn.style.display = ""
      btn.style.top = `${rect.top + 8}px`
      btn.style.right = `${window.innerWidth - rect.right + 8}px`
    }
  }

  function cleanup() {
    if (!entry.alive) return
    entry.alive = false
    clearInterval(entry.timer)
    btn.remove()
    video.removeAttribute(ATTR_ID)
    tracked.delete(video)
  }

  window.addEventListener("resize", update)
  window.addEventListener("scroll", update, true)
  entry.timer = setInterval(update, 1500)
  update()

  btn.addEventListener("click", (e) => {
    e.stopPropagation()
    e.preventDefault()
    chrome.runtime.sendMessage({
      action: "enter-vr",
      selector: `video[${ATTR_ID}="${id}"]`,
    })
  })
}

function scan() {
  document.querySelectorAll("video").forEach((v) => {
    if (v instanceof HTMLVideoElement) addVRButton(v)
  })
}

scan()

// Debounced observer for dynamically added videos
let scanTimer: ReturnType<typeof setTimeout> | null = null
const observer = new MutationObserver(() => {
  if (scanTimer) return
  scanTimer = setTimeout(() => {
    scanTimer = null
    scan()
  }, 300)
})
observer.observe(document.documentElement, { childList: true, subtree: true })
