export const REPO = "https://github.com/acegikmo135/Flashlink"
export const DOCS = `${REPO}/blob/main/docs/setup.md`
export const DOCS_ARCH = `${REPO}/blob/main/docs/architecture.md`
export const DOCS_BOARDS = `${REPO}/blob/main/docs/supported-boards.md`
export const DOCS_SECURITY = `${REPO}/blob/main/docs/security.md`
export const README_START = `${REPO}#get-started`

export const GAP = [
  { t: "The AI sketches the firmware.", m: "the easy part" },
  { t: "You set up a toolchain by hand.", m: "board packages · libraries" },
  { t: "You hunt for the right COM port.", m: "COM3? COM7?" },
  { t: "You pick the flasher, and its flags.", m: "esptool · avrdude" },
  { t: "You flash it, and hope.", m: "did that work?" },
]

export const JOURNEY = [
  { nm: "AI assistant", tg: "MCP client", h: "You ask in plain language.", p: "Claude, ChatGPT, Gemini or Claude Code. Anything that speaks MCP can drive a board on your desk." },
  { nm: "MCP", tg: "OAuth 2.1 + PKCE", h: "One authenticated tool call.", p: "The assistant connects through a custom connector and signs in once. build_and_flash carries the sketch and the board id." },
  { nm: "Cloud compilation", tg: "cloud", h: "The cloud compiles. Your PC never does.", p: "Sketches and third-party libraries build remotely. ESP32 builds come back as a complete image: bootloader, partitions, app." },
  { nm: "In-memory relay", tg: "never stored", h: "Firmware streams. It does not stay.", p: "Bytes pass through a relay held in memory. Size and SHA-256 are enforced end to end, then again on the PC." },
  { nm: "Windows agent", tg: "outbound only", h: "A small tray app on your PC.", p: "It connects out to your own cloud over WSS. It decides which devices may be flashed remotely." },
  { nm: "USB", tg: "right tool per chip", h: "The right programmer, chosen for you.", p: "esptool for ESP32 and ESP8266, avrdude for Uno, Nano and Mega. The assistant never picks, or runs, a flasher." },
  { nm: "Microcontroller", tg: "your board", h: "A real chip, actually written.", p: "The image lands on the board on your desk, not on a simulator." },
  { nm: "Verification", tg: "flash_confirmed", h: "Done means confirmed.", p: "The desktop app reads the flash back and checks SHA-256. Success is reported only after that, never before." },
]

export const SHOTS = [
  {
    id: "devices", tab: "Boards", img: "/media/product-devices.webp",
    h: "Every board, by the name you gave it.",
    p: "Connected boards show their chip and port, a name your assistant can use, and what is happening on them right now.",
    b: ["chip and COM port identified", "custom names, so boards never get mixed up", "live flash progress"],
  },
  {
    id: "activity", tab: "Activity", img: "/media/product-activity.webp",
    h: "Every job, with its verdict.",
    p: "Builds and flashes are logged per account: which board, which build, and whether the device confirmed it.",
    b: ["build and flash history", "re-flash an earlier build", "hashes recorded, not firmware"],
  },
  {
    id: "overview", tab: "Overview", img: "/media/product-overview.webp",
    h: "The state of the bench, at a glance.",
    p: "Boards online, recent jobs and what failed, in one view.",
    b: ["boards online", "recent activity", "failures with a specific error code"],
  },
  {
    id: "access", tab: "Access", img: "/media/product-access.webp",
    h: "Connect an assistant once.",
    p: "Add one connector URL and sign in. Apps and tokens are listed, and each is revocable on its own.",
    b: ["a single connector URL", "connected apps", "revocable access tokens"],
  },
]

export const CAPS = [
  {
    k: "Discover", p: "See what is plugged in before anything is built. The assistant reads real chips and real ports, and refers to boards by the names you gave them.",
    tools: ["list_devices", "identify_mcu", "get_device_info", "get_device_status", "detect_new_devices", "rename_device", "get_supported_boards"],
  },
  {
    k: "Build & flash", p: "Send a sketch, or bring your own toolchain. Either way a flash is a single job with one board, one image and one outcome.",
    tools: ["build_and_flash", "compile_firmware", "flash_firmware", "flash_build", "cancel_flash_job"],
  },
  {
    k: "Build history", p: "Every build is recorded. Put an earlier one back on a board with one sentence, or delete it.",
    tools: ["list_builds", "delete_build", "get_flash_history", "get_flash_job"],
  },
  {
    k: "Observe", p: "Check what the board actually did. Read the chip back, reset it, listen on serial, capture the first seconds of boot.",
    tools: ["verify_flash", "read_serial", "capture_boot_log", "reset_device"],
  },
]

export const HW = [
  { fam: "ESP32", bd: "WROOM-32, WROVER, generic", tier: 1, note: "esp32-wroom-32 flashed and verified on real hardware (Windows)." },
  { fam: "ESP32-S2 · S3 · C3", bd: "Saola-1, S3-DevKitC-1, C3-DevKitM-1, C3 SuperMini", tier: 2, note: "Implemented. Not yet run on hardware." },
  { fam: "ESP8266", bd: "NodeMCU, Wemos D1 mini, generic", tier: 2, note: "Implemented. Not yet run on hardware." },
  { fam: "Arduino Uno · Nano · Mega", bd: "Uno, Nano, Nano (old bootloader), Mega 2560", tier: 2, note: "Implemented, with automatic board detection. Not yet confirmed on hardware." },
  { fam: "STM32", bd: "Blue Pill, Black Pill, Nucleo F103RB / L476RG", tier: 3, note: "Command construction unit-tested only. Needs an ST-Link." },
  { fam: "CH32V003", bd: "CH32V003F4P6", tier: 3, note: "Command construction unit-tested only. Needs a WCH-LinkE." },
]

export const SECURITY = [
  { h: "Firmware is never stored in the cloud.", p: "It moves through memory, is checked against its size and SHA-256 by the relay and again by the agent, and is deleted from your PC after the job." },
  { h: "Your PC only connects out.", p: "The Windows app opens a WSS connection to your own deployment. Nothing on your machine listens for the internet." },
  { h: "The assistant gets a short list of verbs.", p: "Identify, flash, verify, reset, read serial, capture boot log, rescan. There is no shell, file or process primitive." },
  { h: "Access is scoped and revocable.", p: "OAuth 2.1 with PKCE, one-hour access tokens, rotating refresh tokens. Each connected app can be revoked from the dashboard." },
  { h: "You decide which boards are reachable.", p: "The desktop app allow-lists devices. Unrecognised serial ports are never flashable." },
]
