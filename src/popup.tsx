import { useState } from "react"

function Popup() {
  const [status, setStatus] = useState<"idle" | "activating" | "active">("idle")

  const handleActivate = async () => {
    setStatus("activating")
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) return

      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["contents/vr-mode.js"],
      })

      setStatus("active")
    } catch (err) {
      console.error("Failed to activate VR mode:", err)
      setStatus("idle")
    }
  }

  return (
    <div style={{ width: 240, padding: 16 }}>
      <h2 style={{ margin: "0 0 12px" }}>Web VR Player</h2>
      <p style={{ fontSize: 13, color: "#666", margin: "0 0 12px" }}>
        Turn any video into VR mode
      </p>
      <button
        onClick={handleActivate}
        disabled={status === "activating"}
        style={{
          width: "100%",
          padding: "8px 0",
          cursor: status === "activating" ? "wait" : "pointer",
          background: status === "active" ? "#4caf50" : "#1976d2",
          color: "#fff",
          border: "none",
          borderRadius: 6,
          fontSize: 14,
        }}
      >
        {status === "idle" && "Activate VR Mode"}
        {status === "activating" && "Activating..."}
        {status === "active" && "VR Mode Active"}
      </button>
    </div>
  )
}

export default Popup
