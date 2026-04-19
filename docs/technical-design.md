# Web VR Extension — 技术方案

## 1. 项目概述

浏览器插件，将任意网页的 `<video>` 元素转换为 VR 播放模式。无需获取视频源 URL，直接复用 DOM 中已解码的视频帧。

**核心原理**：`THREE.VideoTexture(videoElement)` 绑定的是浏览器已解码的画面流，不受 CORS / blob URL / MSE / DRM 限制（EME 输出保护除外）。

## 2. 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| 插件框架 | Plasmo 0.90+ | MV3、文件约定路由、自动生成 manifest |
| 3D 渲染 | Three.js (CDN) | 运行时注入，不打包进扩展 |
| VR 接口 | WebXR API | 浏览器原生，Three.js `WebXRManager` 封装 |
| UI | React 18 | Popup 界面 |
| 语言 | TypeScript | 全项目 |

## 3. 架构设计

```
┌──────────────────────────────────────────────────┐
│  Browser (target webpage)                        │
│                                                  │
│  ┌──────────┐     ┌──────────────────────────┐   │
│  │ <video>  │────▶│ THREE.VideoTexture       │   │
│  │ (DOM)    │     │ (已解码帧 → 纹理)         │   │
│  └──────────┘     └──────────┬───────────────┘   │
│                              │                   │
│                   ┌──────────▼───────────────┐   │
│                   │  Three.js Scene          │   │
│                   │  ┌─────────────────────┐ │   │
│                   │  │ SphereGeometry (内翻) │ │   │  ← 360° 视频
│                   │  │ 或 PlaneGeometry     │ │   │  ← 普通视频
│                   │  └─────────────────────┘ │   │
│                   │  + PerspectiveCamera     │   │
│                   │  + WebXRManager          │   │
│                   └──────────┬───────────────┘   │
│                              │                   │
│                   ┌──────────▼───────────────┐   │
│                   │  全屏 Canvas 覆盖层       │   │
│                   │  (position: fixed)        │   │
│                   └──────────────────────────┘   │
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │  Content Script (isolated world → MAIN)  │    │
│  │  - 查找 video 元素                       │    │
│  │  - 注入 Three.js CDN                     │    │
│  │  - 创建 VR 场景                          │    │
│  │  - 管理生命周期                          │    │
│  └──────────────────────────────────────────┘    │
└──────────────────────────────────────────────────┘

┌──────────────────┐    messaging     ┌──────────────┐
│  Popup (React)   │ ◀──────────────▶ │  Background   │
│  - 激活 VR 模式   │                  │  Service Worker│
│  - 选择视频模式   │                  │  - 消息中转    │
└──────────────────┘                  └──────────────┘
```

## 4. 模块划分

### 4.1 Content Script — `src/contents/vr-mode.ts`

**职责**：在目标页面中查找 video、注入 Three.js、创建 VR 场景。

**执行环境**：`world: "MAIN"`（需要访问页面 `window` 和 DOM）

**流程**：
1. 查找页面中所有 `<video>` 元素
2. 若有多个 video，高亮标注让用户选择（或自动取正在播放的那个）
3. 隐藏原始 video（`display: none` 或 `visibility: hidden`）
4. 动态加载 Three.js（CDN script 标签注入）
5. 创建全屏 Canvas 覆盖层
6. 初始化 Three.js 场景 + VideoTexture + WebXR
7. 进入 VR 渲染循环

**Three.js 注入方式**：
```typescript
// 方案 A：运行时 CDN 注入（需处理 CSP）
const script = document.createElement("script")
script.src = "https://unpkg.com/three@0.170.0/build/three.module.js"
// ...

// 方案 B（推荐）：Plasmo build-time 远程导入
// 在 content script 中：
import "https://unpkg.com/three@0.170.0/build/three.module.js"
// Plasmo 在构建时抓取并打包，规避 CSP 和 MV3 远程代码限制
```

### 4.2 Popup — `src/popup.tsx`

**职责**：用户交互入口。

**功能**：
- "Activate VR" 按钮 → 向当前 tab 注入 content script
- VR 模式选择：360° 全景 / 普通影院
- 退出 VR 按钮
- 状态显示（当前视频信息）

### 4.3 Background — `src/background.ts`

**职责**：消息中转、状态管理。

- 接收 popup 的激活请求，通过 `chrome.scripting.executeScript` 注入 content script
- 管理 extension storage 中的用户偏好

## 5. VR 渲染方案

### 5.1 360° 全景视频

```typescript
// 球体内翻，摄像机在球心
const geometry = new THREE.SphereGeometry(500, 60, 40)
geometry.scale(-1, 1, 1) // 内翻

const texture = new THREE.VideoTexture(videoElement)
texture.minFilter = THREE.LinearFilter
texture.colorSpace = THREE.SRGBColorSpace

const material = new THREE.MeshBasicMaterial({ map: texture })
const sphere = new THREE.Mesh(geometry, material)
scene.add(sphere)

camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000)
camera.position.set(0, 0, 0)
```

### 5.2 普通视频（影院模式）

```typescript
// 视频贴到平面上，放在虚拟影院环境
const geometry = new THREE.PlaneGeometry(16, 9) // 根据视频比例调整
const texture = new THREE.VideoTexture(videoElement)
const material = new THREE.MeshBasicMaterial({ map: texture })
const screen = new THREE.Mesh(geometry, material)
screen.position.set(0, 2, -5)
scene.add(screen)

// 可选：添加暗色背景、地板、环境光
```

### 5.3 WebXR 集成

```typescript
renderer.xr.enabled = true

// 使用 setAnimationLoop 而非 requestAnimationFrame（VR 必须）
renderer.setAnimationLoop(() => {
  // 更新视频纹理（VideoTexture 自动更新）
  // 更新控制器
  renderer.render(scene, camera)
})

// 进入 VR
const session = await navigator.xr.requestSession("immersive-vr", {
  requiredFeatures: ["local-floor"],
})
renderer.xr.setSession(session)
```

### 5.4 鼠标/触摸控制（非 VR 头显降级方案）

```typescript
// OrbitControls 或自定义拖拽控制视角
// 非沉浸模式下用鼠标拖拽旋转视角
// 支持陀螺仪（移动端 DeviceOrientationEvent）
```

## 6. 关键技术决策

### 6.1 Three.js 加载策略

| 策略 | 优点 | 缺点 |
|------|------|------|
| **Build-time import**（推荐） | 无 CSP 问题、符合 MV3、离线可用 | 包体积大（~600KB gzip） |
| 运行时 CDN 注入 | 不增大扩展体积 | 受 CSP 限制、需网络 |

**决策**：使用 Plasmo 的 `import "https://..."` 语法，构建时打包 Three.js。虽然体积较大，但规避了 CSP 和 MV3 远程代码限制，且离线可用。

### 6.2 Content Script World

| World | 特点 |
|-------|------|
| `ISOLATED`（默认） | 无法访问页面 JS 上下文，但能访问 DOM |
| `MAIN` | 完全访问页面上下文，但失去 Chrome API |

**决策**：使用 `MAIN` world。原因：Three.js 需要访问 `window`、`document`、`navigator.xr` 等完整浏览器 API，且需要与页面 `<video>` 元素直接交互。

### 6.3 视频检测策略

```typescript
// 优先级：正在播放 > 可见 > 最近出现的
function findBestVideo(): HTMLVideoElement | null {
  const videos = Array.from(document.querySelectorAll("video"))

  // 1. 正在播放的
  const playing = videos.find(v => !v.paused && v.readyState >= 2)
  if (playing) return playing

  // 2. 有有效尺寸的（已加载）
  const loaded = videos.find(v => v.videoWidth > 0 && v.videoHeight > 0)
  if (loaded) return loaded

  // 3. 第一个 video
  return videos[0] || null
}
```

## 7. 生命周期管理

```
用户点击 "Activate VR"
    │
    ▼
Popup → Background → chrome.scripting.executeScript
    │
    ▼
Content Script 注入目标页面
    │
    ▼
查找 <video> → 注入 Three.js → 创建 VR 场景
    │
    ▼
全屏 Canvas 覆盖，原始 video 隐藏
    │
    ▼
用户交互（拖拽旋转 / VR 头显 / 退出按钮）
    │
    ▼
退出 VR：销毁场景 → 恢复 video → 移除 Canvas
```

## 8. 已知限制与应对

| 限制 | 影响 | 应对方案 |
|------|------|----------|
| EME 输出保护 | Netflix 等 DRM 视频帧为黑 | 检测 `videoMediaKeys`，提示用户 |
| CSP 严格站点 | 阻止脚本注入 | Build-time 打包规避 |
| 多 video 页面 | 不确定激活哪个 | UI 让用户选择 / 自动取播放中的 |
| 移动端 | WebXR 支持有限 | 降级为陀螺仪 + 触摸控制 |
| 性能 | 视频纹理每帧更新 | 限制分辨率、使用 `LinearFilter` |

## 9. 项目结构

```
web-vr-extension/
├── src/
│   ├── popup.tsx              # 插件弹出界面
│   ├── background.ts          # 后台服务
│   └── contents/
│       ├── vr-mode.ts         # VR 模式 content script（主入口）
│       └── vr-scene.ts        # Three.js 场景构建逻辑
├── assets/
│   └── icon.png               # 插件图标（Plasmo 自动生成多尺寸）
├── docs/
│   └── technical-design.md    # 本文档
├── package.json               # 依赖 + manifest 覆盖
├── tsconfig.json
└── .gitignore
```

## 10. 开发路线

1. **Phase 1 — 基础骨架**：插件安装加载，popup 可点击，能找到 video 元素
2. **Phase 2 — 360° 全景模式**：Three.js 场景 + VideoTexture + 鼠标控制
3. **Phase 3 — WebXR 沉浸模式**：VR 头显支持、控制器交互
4. **Phase 4 — 影院模式**：普通视频在虚拟影院播放
5. **Phase 5 — 多视频选择 & UX 优化**：视频高亮选择、设置持久化
