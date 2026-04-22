import * as THREE from "three"

interface VRConfig {
  selector: string
  mode: "360" | "cinema"
}

function findVideo(sel: string): HTMLVideoElement | null {
  const el = document.querySelector(sel)
  if (el instanceof HTMLVideoElement) return el
  return null
}

function initVR(config: VRConfig) {
  if (document.getElementById("web-vr-container")) return

  const video = findVideo(config.selector)!
  if (!video) return

  let currentMode = config.mode
  let isDragging = false
  let prevX = 0, prevY = 0, lon = 0, lat = 0
  let animationId: number

  // --- Overlay ---
  const container = document.createElement("div")
  container.id = "web-vr-container"
  Object.assign(container.style, {
    position: "fixed", top: "0", left: "0",
    width: "100vw", height: "100vh",
    zIndex: "2147483647", background: "#000", cursor: "grab",
  })
  document.body.appendChild(container)

  // --- Hide original video ---
  const originalDisplay = video.style.display
  video.style.display = "none"

  // --- Three.js ---
  // Match competitor's config exactly: powerPreference + capped pixelRatio
  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
  renderer.setPixelRatio(window.devicePixelRatio)
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  container.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000)

  // Use VideoTexture directly — modern browsers have hardware-accelerated
  // paths that can upload video frames to GPU with zero CPU copies.
  // Intermediate Canvas forces CPU-side blit + extra upload, which is slower.
  const texture = new THREE.VideoTexture(video)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.generateMipmaps = false

  function buildScene(mode: "360" | "cinema") {
    while (scene.children.length > 0) scene.remove(scene.children[0])
    camera.fov = mode === "360" ? 75 : 50
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()

    if (mode === "360") {
      scene.background = null
      camera.position.set(0, 0, 0)
      const radius = 500
      const ws = Math.min(60, Math.max(32, Math.floor((video.videoWidth || 1920) / 64)))
      const hs = Math.min(40, Math.max(16, Math.floor((video.videoHeight || 1080) / 64)))
      const geo = new THREE.SphereGeometry(radius, ws, hs)
      geo.scale(-1, 1, 1)
      scene.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: texture })))
    } else {
      scene.background = new THREE.Color(0x111111)
      scene.add(new THREE.GridHelper(20, 20, 0x333333, 0x222222))
      const aspect = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 16 / 9
      const sw = 16, sh = sw / aspect
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), new THREE.MeshBasicMaterial({ map: texture }))
      screen.position.set(0, sh / 2 + 1, -5)
      scene.add(screen)
      const border = new THREE.Mesh(new THREE.PlaneGeometry(sw + 0.4, sh + 0.4), new THREE.MeshBasicMaterial({ color: 0x1a1a1a }))
      border.position.set(0, sh / 2 + 1, -5.01)
      scene.add(border)
      camera.position.set(0, 2, 5)
      camera.lookAt(0, 2, -5)
    }
    lon = 0
    lat = 0
  }

  buildScene(currentMode)

  // --- Mouse controls ---
  container.addEventListener("mousedown", (e) => {
    isDragging = true
    prevX = e.clientX
    prevY = e.clientY
    container.style.cursor = "grabbing"
  })
  window.addEventListener("mousemove", (e) => {
    if (!isDragging) return
    lon -= (e.clientX - prevX) * 0.2
    lat += (e.clientY - prevY) * 0.2
    lat = Math.max(-85, Math.min(85, lat))
    prevX = e.clientX
    prevY = e.clientY
    needRender = true
  })
  window.addEventListener("mouseup", () => {
    isDragging = false
    container.style.cursor = "grab"
  })
  container.addEventListener("wheel", (e) => {
    e.preventDefault()
    camera.fov = Math.max(20, Math.min(120, camera.fov + e.deltaY * 0.05))
    camera.updateProjectionMatrix()
    needRender = true
  }, { passive: false })

  // --- Controls bar ---
  const btnStyle: Partial<CSSStyleDeclaration> = {
    background: "none", border: "none", color: "#ddd", cursor: "pointer",
    fontSize: "18px", padding: "4px 8px", lineHeight: "1", userSelect: "none",
  }

  const controlsBar = document.createElement("div")
  Object.assign(controlsBar.style, {
    position: "absolute", bottom: "0", left: "0", width: "100%",
    display: "flex", alignItems: "center", gap: "8px",
    padding: "8px 12px", boxSizing: "border-box",
    background: "linear-gradient(transparent, rgba(0,0,0,0.6))",
    transition: "opacity 0.3s", opacity: "0", zIndex: "10",
  })
  container.appendChild(controlsBar)

  // Play / Pause button
  const playBtn = document.createElement("button")
  Object.assign(playBtn.style, btnStyle)
  playBtn.textContent = video.paused ? "▶" : "⏸"
  playBtn.addEventListener("click", (e) => {
    e.stopPropagation()
    video.paused ? video.play().catch(() => {}) : video.pause()
  })
  controlsBar.appendChild(playBtn)

  // Progress area (time + bar)
  const progressArea = document.createElement("div")
  Object.assign(progressArea.style, { flex: "1", display: "flex", flexDirection: "row", gap: "2px", alignItems: "center" })
  controlsBar.appendChild(progressArea)

  const progressBar = document.createElement("div")
  Object.assign(progressBar.style, {
    width: "100%", height: "8px", background: "rgba(255,255,255,0.2)",
    borderRadius: "4px", cursor: "pointer", position: "relative",
  })
  progressArea.appendChild(progressBar)

  const progressFill = document.createElement("div")
  Object.assign(progressFill.style, {
    height: "100%", background: "#1976d2", borderRadius: "4px",
    width: "0%", pointerEvents: "none",
  })
  progressBar.appendChild(progressFill)

  const timeLabel = document.createElement("div")
  Object.assign(timeLabel.style, {
    color: "#bbb", fontSize: "11px", fontFamily: "monospace",
    textAlign: "right", userSelect: "none", flexShrink: 0
  })
  progressArea.appendChild(timeLabel)

  // Mute button
  const muteBtn = document.createElement("button")
  Object.assign(muteBtn.style, btnStyle)
  muteBtn.textContent = video.muted ? "🔇" : "🔊"
  muteBtn.addEventListener("click", (e) => {
    e.stopPropagation()
    video.muted = !video.muted
    muteBtn.textContent = video.muted ? "🔇" : "🔊"
  })
  controlsBar.appendChild(muteBtn)

  function formatTime(s: number) {
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = Math.floor(s % 60)
    return h > 0
      ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
      : `${m}:${String(sec).padStart(2, "0")}`
  }

  progressBar.addEventListener("click", (e) => {
    const rect = progressBar.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    if (isFinite(video.duration)) video.currentTime = ratio * video.duration
  })

  let hideTimer = 0
  function showControls() {
    controlsBar.style.opacity = "1"
    clearTimeout(hideTimer)
    hideTimer = window.setTimeout(() => { controlsBar.style.opacity = "0" }, 3000)
  }
  container.addEventListener("mousemove", showControls)
  container.addEventListener("mousedown", showControls)
  showControls()

  // Sync play button with video state
  video.addEventListener("play", () => { playBtn.textContent = "⏸" })
  video.addEventListener("pause", () => { playBtn.textContent = "▶" })

  // --- Keyboard shortcuts ---
  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      cleanup()
    } else if (e.key === "ArrowLeft") {
      e.preventDefault()
      video.currentTime = Math.max(0, video.currentTime - 10)
      showControls()
    } else if (e.key === "ArrowRight") {
      e.preventDefault()
      video.currentTime = Math.min(video.duration || 0, video.currentTime + 10)
      showControls()
    } else if (e.key === "Enter") {
      e.preventDefault()
      video.paused ? video.play().catch(() => {}) : video.pause()
    }
  }
  window.addEventListener("keydown", onKeyDown)

  // --- FOV indicator ---
  const fovLabel = document.createElement("div")
  Object.assign(fovLabel.style, {
    position: "absolute", top: "16px", right: "16px",
    color: "#aaa", fontSize: "13px", fontFamily: "monospace",
    opacity: "0", transition: "opacity 0.5s", pointerEvents: "none",
    userSelect: "none",
  })
  fovLabel.textContent = `FOV ${Math.round(camera.fov)}°`
  container.appendChild(fovLabel)

  let fovTimer = 0
  function showFovLabel() {
    fovLabel.textContent = `FOV ${Math.round(camera.fov)}°`
    fovLabel.style.opacity = "1"
    clearTimeout(fovTimer)
    fovTimer = window.setTimeout(() => { fovLabel.style.opacity = "0" }, 1200)
  }

  container.addEventListener("wheel", () => { showFovLabel() }, { passive: true })

  // --- Render loop ---
  // Match competitor's strategy: 60fps cap + dirty rendering
  let needRender = true
  let lastFrame = 0
  let lastUIUpdate = 0

  function animate(now: number) {
    animationId = requestAnimationFrame(animate)
    if (document.hidden) return

    // Cap at ~60fps
    if (now - lastFrame < 16.6) return
    lastFrame = now

    const phi = THREE.MathUtils.degToRad(90 - lat)
    const theta = THREE.MathUtils.degToRad(lon)

    if (currentMode === "360") {
      camera.lookAt(500 * Math.sin(phi) * Math.cos(theta), 500 * Math.cos(phi), 500 * Math.sin(phi) * Math.sin(theta))
    } else {
      camera.position.x = 3 * Math.sin(phi) * Math.cos(theta)
      camera.position.y = 2 + 1 * Math.cos(phi)
      camera.position.z = 5 + 3 * Math.sin(phi) * Math.sin(theta)
      camera.lookAt(0, 2, -5)
    }

    // Update texture only when video is actively playing
    if (!video.paused && video.readyState >= 2) {
      texture.needsUpdate = true
      needRender = true
    }

    // Update UI at 4Hz
    if (now - lastUIUpdate > 250) {
      lastUIUpdate = now
      if (isFinite(video.duration) && video.duration > 0) {
        progressFill.style.width = `${(video.currentTime / video.duration) * 100}%`
        timeLabel.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`
      }
    }

    if (needRender) {
      renderer.render(scene, camera)
      needRender = false
    }
  }
  animate(performance.now())

  // --- Resize ---
  function onResize() {
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(window.innerWidth, window.innerHeight)
  }
  window.addEventListener("resize", onResize)

  if (video.paused) video.play().catch(() => {})

  // --- Cleanup ---
  function cleanup() {
    cancelAnimationFrame(animationId)
    window.removeEventListener("resize", onResize)
    window.removeEventListener("keydown", onKeyDown)
    renderer.dispose()
    texture.dispose()
    container.remove()
    video.style.display = originalDisplay
    ;(window as any).__webVRActive = false
    delete (window as any).__webVRCleanup
    delete (window as any).__webVRSwitchMode
  }

  // --- Switch mode ---
  function switchMode(newMode: "360" | "cinema") {
    if (newMode === currentMode) return
    currentMode = newMode
    buildScene(newMode)
  }

  // --- Expose to popup ---
  ;(window as any).__webVRActive = true
  ;(window as any).__webVRConfig = config
  ;(window as any).__webVRCleanup = cleanup
  ;(window as any).__webVRSwitchMode = switchMode
}

// Expose init function (survives cleanup — allows re-entry without re-eval)
;(window as any).__webVRInit = initVR

// Auto-init if config already set (first run via eval)
if ((window as any).__webVRConfig) {
  initVR((window as any).__webVRConfig)
}
