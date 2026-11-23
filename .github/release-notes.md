Download the file for your computer below.

| Platform | File |
| --- | --- |
| macOS (Apple Silicon) | `HAM-<version>-mac-arm64.dmg` |
| macOS (Intel) | `HAM-<version>-mac-x64.dmg` |
| Windows | `HAM-<version>-win-x64.exe` (or `-arm64.exe`) |
| Linux | `HAM-<version>-linux-x64.AppImage` (or `-arm64.AppImage`) |

**These builds aren't code-signed yet**, so your system will warn you the first time:

- **macOS:** open the app once, then go to System Settings › Privacy & Security and click **Open Anyway**. Or run `xattr -dr com.apple.quarantine /Applications/HAM.app`.
- **Windows:** in the SmartScreen dialog, click **More info › Run anyway**.
- **Linux:** `chmod +x HAM-*.AppImage`, then run it.

HAM checks for new versions when it starts and shows a banner when one is out. Updates are manual: download the new version and replace the old one. Your accounts stay signed in. On macOS, after an update you may be asked to let HAM use its "HAM Safe Storage" keychain item, which holds the key that encrypts your sessions. Choose **Always Allow**.
