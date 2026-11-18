// Yew Harness for the Mac: the web interface in a window of its own, with an icon in the Dock.
//
// `yew app install` puts this program in ~/Applications/Yew.app, next to a small script
// (Contents/Resources/yew-link) that starts Yew Harness when it is not running and prints a
// one-time link that signs the window in. Yew Harness itself keeps running when the window closes
// or the app quits, as it does when a browser tab is closed.
import AppKit

let delegate = AppDelegate()
NSApplication.shared.delegate = delegate
NSApplication.shared.setActivationPolicy(.regular)
NSApplication.shared.run()
