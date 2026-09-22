; Inno Setup Script for Concord
; Ensures the "Publisher" registry key is correctly written to HKLM/HKCU Uninstall entries
; to comply with Microsoft Store certification requirement 10.2.7

#define MyAppName "Concord"
#define MyAppPublisher "Nathã S Targino"
#define MyAppURL "https://github.com/nathatargino/Concord-Repo"
#define MyAppExeName "Concord.exe"

[Setup]
AppId={{542196E4-D510-47BC-894E-FB82CF5DF15A}
AppName={#MyAppName}
AppVersion=1.0.92
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DisableProgramGroupPage=yes
OutputBaseFilename=Concord-Setup
Compression=lzma
SolidCompression=yes
WizardStyle=modern

[Registry]
; Explicitly enforce Publisher in uninstall key for both 32-bit and 64-bit views
Root: HKA; Subkey: "Software\Microsoft\Windows\CurrentVersion\Uninstall\{#MyAppName}"; ValueType: string; ValueName: "Publisher"; ValueData: "{#MyAppPublisher}"; Flags: uninsdeletekeyifempty
