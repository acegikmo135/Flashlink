// Every string on the page that states a fact lives here, with its source in the repo.
export const LINKS = {
  github: "https://github.com/acegikmo135/Flashlink",
  installer: "https://github.com/acegikmo135/Flashlink/releases/download/desktop-latest/MCUBridge-Setup.exe",
  maker: "https://manthank.com",
};
export const MCP_URL = "https://mcu-bridge.manthankansagra.workers.dev/mcp";
export const MCP_CMD = `claude mcp add --transport http mcu-bridge ${MCP_URL} --header "Authorization: Bearer <token>"`;
export const SETUP_CMD = `git clone https://github.com/acegikmo135/Flashlink.git
cd Flashlink
node scripts/setup.mjs`;

export const STAGES = [
  { title: "AI chat", body: "You ask in Claude, ChatGPT or Gemini. The AI writes the sketch and calls MCU Bridge over MCP.", icon: "chat" },
  { title: "Cloud compile", body: "The Worker compiles it, libraries included, and builds a strict manifest: size, SHA-256 and flash settings.", icon: "cloud" },
  { title: "Your PC", body: "The tray app takes the firmware over its outbound WebSocket and checks size and SHA-256 again before it writes anything.", icon: "pc" },
  { title: "Your board", body: "Flashed over USB, verified, reset. Only when the app confirms does the AI report it done.", icon: "chip" },
] as const;
export const LINK_LABELS = ["MCP", "outbound WSS", "USB"];

export const TRANSCRIPT: { t: "call" | "out" | "ok"; text: string }[] = [
  { t: "call", text: "compile_firmware  board=arduino-uno  libraries=[\"Adafruit NeoPixel\"]" },
  { t: "out", text: "ok  size_bytes=6264  sha256=6094da1f97dd7519…" },
  { t: "call", text: "flash_firmware  manifest={ … }  verify=true" },
  { t: "out", text: "firmware streams to your PC through memory only" },
  { t: "call", text: "get_flash_job  wait_seconds=20" },
  { t: "ok", text: "status: completed   flash_confirmed: true" },
];
export const JOB_STATES = ["awaiting_upload", "transferring", "flashing", "verifying", "completed"];

export const READOUTS: [string, string][][] = [
  [["tools/call", "build_and_flash"], ["auth", "OAuth 2.1 · PKCE S256"]],
  [["compile", "ok"], ["manifest", "size · sha-256 · flash config"], ["relay", "in memory"]],
  [["size", "match"], ["sha-256", "match"], ["chip id", "match"]],
  [["write", "ok"], ["read-back", "match"], ["reset", "boot log captured"]],
];

export const FLASH_PARTS = [
  { name: "bootloader.bin", addr: 0x1000, size: 17104, label: "17,104 B" },
  { name: "partitions.bin", addr: 0x8000, size: 3072, label: "3,072 B" },
  { name: "boot_app0.bin", addr: 0xe000, size: 8192, label: "8,192 B" },
  { name: "firmware.bin", addr: 0x10000, size: 0x140000, label: "your app" },
];

export const CONNECT = [
  { id: "claude-code", name: "Claude Code", how: "Add the server with an access token. Create one in the dashboard under Access.", cmd: true },
  { id: "claude-ai", name: "claude.ai", how: "Settings → Connectors → Add custom connector. Paste the endpoint, press Connect, sign in and allow access.", cmd: false },
  { id: "chatgpt", name: "ChatGPT", how: "Add a custom connector with the endpoint, then sign in once.", cmd: false },
  { id: "gemini", name: "Gemini", how: "Add an MCP connector with the endpoint. Client registration is automatic.", cmd: false },
];

export const AIS = [
  { name: "Claude", how: "In Claude Code, add the server with an access token (the command below). In claude.ai, add the endpoint as a custom connector and sign in with OAuth." },
  { name: "ChatGPT", how: "Add the endpoint as a custom connector and sign in once." },
  { name: "Gemini", how: "Add the endpoint as an MCP connector. Client registration is automatic." },
];

export const TOOLS: { group: string; note: string; items: [string, string][] }[] = [
  { group: "Sense", note: "What is plugged in.", items: [
    ["list_devices", "Boards on your PC and their state."],
    ["get_device_info", "Chip, flash size and tooling for one board."],
    ["identify_mcu", "Ask the chip what it is."],
    ["get_device_status", "Idle, flashing or offline."],
    ["detect_new_devices", "Wait for a board to be plugged in."],
  ] },
  { group: "Build", note: "From source to firmware.", items: [
    ["compile_firmware", "Compile a sketch in the cloud."],
    ["build_and_flash", "Compile and flash in one call."],
    ["list_builds", "Your build history: hashes, never firmware."],
    ["flash_build", "Flash an earlier build again."],
    ["delete_build", "Remove a build from your history."],
  ] },
  { group: "Flash", note: "Put it on the board.", items: [
    ["flash_firmware", "Flash firmware you built yourself."],
    ["get_flash_job", "Follow a job until it finishes."],
    ["cancel_flash_job", "Stop a job in progress."],
    ["reset_device", "Reset the board."],
    ["rename_device", "Give a board your own name."],
  ] },
  { group: "Verify and observe", note: "Prove it worked.", items: [
    ["verify_flash", "Compare the board with a firmware package."],
    ["read_serial", "Read serial output."],
    ["capture_boot_log", "Reset and capture the boot log."],
    ["get_flash_history", "Past flashes, outcomes and error codes."],
    ["get_supported_boards", "Boards, tools and limits."],
  ] },
];

export const BOARDS = [
  { family: "ESP32 family", boards: "ESP32, ESP32-S2, ESP32-S3, ESP32-C3, ESP8266", tool: "esptool", status: "ESP32 is **flashed and verified on real hardware**. The others are implemented and not yet run on hardware." },
  { family: "Arduino AVR", boards: "Uno, Nano, Nano (old bootloader), Mega 2560", tool: "avrdude", status: "Implemented. The app auto-detects the exact board. **Not yet confirmed on hardware.**" },
  { family: "STM32", boards: "Blue Pill, Black Pill, Nucleo", tool: "STM32CubeProgrammer or OpenOCD", status: "Implemented. Needs an ST-Link. Command lines are unit-tested; **not yet run on hardware.**" },
];

export const SECURITY: [string, string][] = [
  ["Sign-in for AI", "OAuth 2.1 with mandatory PKCE (S256)."],
  ["Passwords", "PBKDF2-SHA256, 100,000 iterations."],
  ["MCP tokens", "Stored hashed, revocable at any time, limited to 120 calls a minute each."],
  ["Firmware integrity", "Exact size and SHA-256, enforced end to end: checked in the relay and again on your PC."],
  ["Manifests", "Strict schema. Boards and flash configurations are allow-listed; unknown keys are rejected."],
  ["Desktop agent", "Exposes no shell, file or process primitive. Subprocesses are fixed argument templates with shell=False."],
  ["Desktop credential", "Stored with Windows DPAPI."],
  ["Per-device allow-list", "Unrecognised serial ports are never flashable."],
  ["Firmware retention", "Streams through an in-memory relay and is never stored in the cloud. Deleted from your PC after the job."],
];

export const FAQ: [string, string][] = [
  ["Does my PC compile anything?", "No. The cloud compiles. Your PC only receives the firmware, checks it, flashes the board and reports back."],
  ["Is my firmware stored in the cloud?", "No. It streams through an in-memory relay and is deleted from your PC after the job. The database keeps metadata only: hashes, sizes and results. Cloud compile does send your sketch source to a public Arduino build service, so do not compile secrets."],
  ["Which boards does it flash?", "The ESP32 family (ESP32, S2, S3, C3, ESP8266), Arduino Uno, Nano and Mega, and STM32. ESP32 is verified on real hardware; the others are implemented and still need hardware testing."],
  ["Which AI chats work?", "Claude, ChatGPT and Gemini, through MCP with OAuth. Claude Code can also use an access token."],
  ["Is it open source?", "Yes. The cloud, the web dashboard and the Windows app are on GitHub."],
];
