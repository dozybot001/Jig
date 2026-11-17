import UIKit
@preconcurrency import UserNotifications

/// What the system tells the app about notifications, passed on to the model: this phone's token,
/// a tap on a notification, and the quiet ones that take handled notifications away.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
	func application(
		_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
	) -> Bool {
		UNUserNotificationCenter.current().delegate = self
		return true
	}

	func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
		PushCenter.shared.token = deviceToken.map { String(format: "%02x", $0) }.joined()
	}

	func application(
		_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any],
		fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
	) {
		guard let note = PushNote(userInfo: userInfo), let clear = note.clear else {
			completionHandler(.noData)
			return
		}
		let badge = note.badge
		Task { @MainActor in
			await PushCenter.take(away: clear, badge: badge)
			completionHandler(.newData)
		}
	}

	/// With the app in front, a notification still shows as a banner, without sound.
	nonisolated func userNotificationCenter(
		_ center: UNUserNotificationCenter, willPresent notification: UNNotification
	) async -> UNNotificationPresentationOptions {
		[.banner, .list]
	}

	nonisolated func userNotificationCenter(
		_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse
	) async {
		let session = response.notification.request.content.userInfo["yew.session"] as? String
		await MainActor.run { PushCenter.shared.opened = .some(session) }
	}
}

/// Where the app delegate leaves what it hears until the model takes it.
@MainActor
final class PushCenter {
	static let shared = PushCenter()
	weak var model: AppModel? {
		didSet { hand() }
	}
	/// This phone's APNs token, in hex.
	var token: String? {
		didSet { hand() }
	}
	/// A notification was tapped: the session it is about, or none for the approval center.
	var opened: String?? {
		didSet { hand() }
	}

	private func hand() {
		guard let model else { return }
		if let token { model.pushToken(token) }
		if let target = opened {
			opened = nil
			model.open(session: target)
		}
	}

	enum State { case on, off, notAsked }

	static func state() async -> State {
		switch await UNUserNotificationCenter.current().notificationSettings().authorizationStatus {
		case .authorized, .provisional, .ephemeral: .on
		case .denied: .off
		default: .notAsked
		}
	}

	/// Registers with Apple, and asks for permission to show notifications the first time. The token
	/// does not depend on the answer: without permission nothing is shown, but the badge still follows.
	@discardableResult
	static func turnOn() async -> State {
		UIApplication.shared.registerForRemoteNotifications()
		var now = await state()
		if now == .notAsked {
			let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])) ?? false
			now = granted ? .on : .off
		}
		return now
	}

	/// Handled items: their notifications come off the screen and the badge follows the approval center.
	static func take(away ids: [String], badge: Int?) async {
		let center = UNUserNotificationCenter.current()
		let delivered = await center.deliveredNotifications()
		let gone = delivered.filter { shown in
			ids.contains(shown.request.identifier)
				|| (shown.request.content.userInfo["yew.id"] as? String).map(ids.contains) == true
		}
		center.removeDeliveredNotifications(withIdentifiers: gone.map(\.request.identifier))
		if let badge { try? await center.setBadgeCount(badge) }
	}

	/// The approval center was loaded: the badge is its count, and with nothing waiting no notification stays.
	static func show(waiting count: Int) async {
		let center = UNUserNotificationCenter.current()
		try? await center.setBadgeCount(count)
		if count == 0 { center.removeAllDeliveredNotifications() }
	}
}
