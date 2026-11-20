; MCU Bridge installer (Inno Setup 6). Per-user install: no administrator rights, no UAC prompt.
#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif

[Setup]
AppId={{5050065E-2059-422E-9C59-9A073DBF26DF}}
AppName=MCU Bridge
AppVersion={#AppVersion}
AppVerName=MCU Bridge {#AppVersion}
AppPublisher=MCU Bridge
DefaultDirName={autopf}\MCU Bridge
DefaultGroupName=MCU Bridge
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
OutputDir=..\dist
OutputBaseFilename=MCUBridge-Setup
SetupIconFile=..\assets\icon.ico
UninstallDisplayIcon={app}\MCUBridge.exe
Compression=lzma2/ultra64
SolidCompression=yes
LZMAUseSeparateProcess=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes
RestartApplications=no
DisableWelcomePage=no
VersionInfoVersion={#AppVersion}.0
VersionInfoProductName=MCU Bridge

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "startup"; Description: "Start MCU Bridge when I sign in to Windows"; GroupDescription: "Options:"
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Options:"; Flags: unchecked

[Files]
Source: "..\dist\MCUBridge\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{autoprograms}\MCU Bridge"; Filename: "{app}\MCUBridge.exe"
Name: "{autodesktop}\MCU Bridge"; Filename: "{app}\MCUBridge.exe"; Tasks: desktopicon

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "MCUBridge"; ValueData: """{app}\MCUBridge.exe"" --minimized"; Tasks: startup; Flags: uninsdeletevalue

[Run]
Filename: "{app}\MCUBridge.exe"; Description: "Launch MCU Bridge"; Flags: nowait postinstall skipifsilent
