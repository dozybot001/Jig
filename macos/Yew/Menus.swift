import AppKit

/// The menu bar: the app's menu (About and Settings open the page's own), Edit (so copy and paste
/// work in the page), View and Window.
@MainActor
enum Menus {
	static func make(target: AppDelegate) -> NSMenu {
		let bar = NSMenu()
		let name = "Yew Harness"

		let app = submenu(of: bar, title: name)
		app.addItem(item(Text.pick("关于 \(name)", "About \(name)"), #selector(AppDelegate.showAbout), target))
		app.addItem(.separator())
		app.addItem(item(Text.pick("设置…", "Settings…"), #selector(AppDelegate.showSettings), target, ","))
		app.addItem(.separator())
		let services = NSMenu()
		let servicesItem = NSMenuItem(title: Text.pick("服务", "Services"), action: nil, keyEquivalent: "")
		servicesItem.submenu = services
		app.addItem(servicesItem)
		NSApp.servicesMenu = services
		app.addItem(.separator())
		app.addItem(item(Text.pick("隐藏 \(name)", "Hide \(name)"), #selector(NSApplication.hide(_:)), nil, "h"))
		let others = item(
			Text.pick("隐藏其他", "Hide Others"), #selector(NSApplication.hideOtherApplications(_:)), nil, "h")
		others.keyEquivalentModifierMask = [.command, .option]
		app.addItem(others)
		app.addItem(
			item(Text.pick("全部显示", "Show All"), #selector(NSApplication.unhideAllApplications(_:)), nil))
		app.addItem(.separator())
		app.addItem(item(Text.pick("退出 \(name)", "Quit \(name)"), #selector(NSApplication.terminate(_:)), nil, "q"))

		let edit = submenu(of: bar, title: Text.pick("编辑", "Edit"))
		edit.addItem(item(Text.pick("撤销", "Undo"), Selector(("undo:")), nil, "z"))
		let redo = item(Text.pick("重做", "Redo"), Selector(("redo:")), nil, "z")
		redo.keyEquivalentModifierMask = [.command, .shift]
		edit.addItem(redo)
		edit.addItem(.separator())
		edit.addItem(item(Text.pick("剪切", "Cut"), #selector(NSText.cut(_:)), nil, "x"))
		edit.addItem(item(Text.pick("拷贝", "Copy"), #selector(NSText.copy(_:)), nil, "c"))
		edit.addItem(item(Text.pick("粘贴", "Paste"), #selector(NSText.paste(_:)), nil, "v"))
		edit.addItem(item(Text.pick("全选", "Select All"), #selector(NSText.selectAll(_:)), nil, "a"))

		let view = submenu(of: bar, title: Text.pick("显示", "View"))
		view.addItem(item(Text.pick("重新载入", "Reload"), #selector(AppDelegate.reloadPage), target, "r"))
		view.addItem(.separator())
		view.addItem(item(Text.pick("实际大小", "Actual Size"), #selector(AppDelegate.actualSize), target, "0"))
		view.addItem(item(Text.pick("放大", "Zoom In"), #selector(AppDelegate.zoomIn), target, "="))
		view.addItem(item(Text.pick("缩小", "Zoom Out"), #selector(AppDelegate.zoomOut), target, "-"))
		view.addItem(.separator())
		let fullScreen = item(
			Text.pick("进入全屏幕", "Enter Full Screen"), #selector(NSWindow.toggleFullScreen(_:)), nil, "f")
		fullScreen.keyEquivalentModifierMask = [.command, .control]
		view.addItem(fullScreen)

		let window = submenu(of: bar, title: Text.pick("窗口", "Window"))
		window.addItem(item(Text.pick("最小化", "Minimize"), #selector(NSWindow.performMiniaturize(_:)), nil, "m"))
		window.addItem(item(Text.pick("缩放", "Zoom"), #selector(NSWindow.performZoom(_:)), nil))
		window.addItem(item(Text.pick("关闭", "Close"), #selector(NSWindow.performClose(_:)), nil, "w"))
		window.addItem(.separator())
		window.addItem(
			item(Text.pick("前置全部窗口", "Bring All to Front"), #selector(NSApplication.arrangeInFront(_:)), nil))
		NSApp.windowsMenu = window

		return bar
	}

	private static func submenu(of bar: NSMenu, title: String) -> NSMenu {
		let menu = NSMenu(title: title)
		let holder = NSMenuItem(title: title, action: nil, keyEquivalent: "")
		holder.submenu = menu
		bar.addItem(holder)
		return menu
	}

	private static func item(_ title: String, _ action: Selector, _ target: AnyObject?, _ key: String = "")
		-> NSMenuItem
	{
		let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
		item.target = target
		return item
	}
}
